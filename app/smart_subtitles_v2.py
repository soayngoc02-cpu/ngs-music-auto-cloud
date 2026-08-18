import math
from pathlib import Path

from app.smart_subtitles import (
    TOKEN_RE,
    TimedLine,
    _align_tokens,
    _best_window,
    _fallback_vocal_timing,
    _flatten_expected,
    _lyrics_lines,
    _transcribe_words,
    extract_audio_clip,
)


def _direct_event(line: str, hits: list[tuple[dict, float]]) -> TimedLine | None:
    if not hits:
        return None
    words = [item[0] for item in hits]
    sims = [item[1] for item in hits]
    start = min(float(word['start']) for word in words)
    end = max(float(word['end']) for word in words)
    return TimedLine(line, start, max(end, start + 0.25), sum(sims) / max(1, len(sims)))


def _word_slice(words: list[dict], start: float, end: float) -> list[dict]:
    return [
        word for word in words
        if float(word.get('end', 0)) > start + 0.03 and float(word.get('start', 0)) < end - 0.03
    ]


def _split_lines_over_words(line_ids: list[int], lines: list[str], words: list[dict], clip_duration: float) -> dict[int, TimedLine]:
    if not line_ids or not words:
        return {}
    weights = [max(1, len(TOKEN_RE.findall(lines[line_id]))) for line_id in line_ids]
    total = max(1, sum(weights))
    count = len(words)
    cursor = 0
    out: dict[int, TimedLine] = {}
    for index, (line_id, weight) in enumerate(zip(line_ids, weights)):
        begin_ratio = cursor / total
        cursor += weight
        end_ratio = cursor / total
        begin_i = min(count - 1, max(0, int(math.floor(begin_ratio * count))))
        end_i = min(count - 1, max(begin_i, int(math.ceil(end_ratio * count)) - 1))
        selected = words[begin_i:end_i + 1]
        if not selected:
            continue
        start = max(0.0, float(selected[0]['start']))
        end = min(clip_duration, max(start + 0.28, float(selected[-1]['end'])))
        if index + 1 < len(line_ids):
            next_ratio = cursor / total
            next_i = min(count - 1, max(0, int(math.floor(next_ratio * count))))
            next_start = float(words[next_i]['start'])
            if next_start > start + 0.15:
                end = min(clip_duration, max(end, next_start - 0.04))
        probs = [float(word.get('probability', 0.0) or 0.0) for word in selected]
        confidence = max(0.2, (sum(probs) / max(1, len(probs))) * 0.58)
        if end > start + 0.12:
            out[line_id] = TimedLine(lines[line_id], start, end, confidence)
    return out


def _repair_local_gaps(
    lines: list[str],
    direct: dict[int, TimedLine],
    recognized_words: list[dict],
    clip_duration: float,
) -> tuple[dict[int, TimedLine], dict]:
    """Fill missing lyric lines only where Whisper still detected vocals.

    Long lyric gaps are repaired using real word timestamps. Instrumental gaps stay empty.
    """
    repaired = dict(direct)
    anchors = sorted(direct)
    repaired_lines = 0
    preserved_instrumental_gaps = 0
    if not anchors:
        return repaired, {'repaired_lines': 0, 'instrumental_gaps': 0}

    # Fill between reliable anchors.
    for left_id, right_id in zip(anchors, anchors[1:]):
        missing = list(range(left_id + 1, right_id))
        if not missing:
            continue
        left = repaired[left_id]
        right = repaired[right_id]
        free_start = max(0.0, left.end - 0.08)
        free_end = min(clip_duration, right.start + 0.08)
        if free_end <= free_start + 0.15:
            continue
        vocal_words = _word_slice(recognized_words, free_start, free_end)
        # Require actual vocal evidence. This is what prevents filling an instrumental break.
        if len(vocal_words) < max(1, min(3, len(missing))):
            preserved_instrumental_gaps += 1
            continue
        filled = _split_lines_over_words(missing, lines, vocal_words, clip_duration)
        repaired.update(filled)
        repaired_lines += len(filled)

    # Fill a short leading lyric run if Whisper detected vocals before the first anchor.
    first_id = anchors[0]
    first = repaired[first_id]
    if first_id > 0 and first.start > 0.6:
        leading_ids = list(range(max(0, first_id - 4), first_id))
        leading_words = _word_slice(recognized_words, 0.0, first.start + 0.05)
        if leading_words:
            filled = _split_lines_over_words(leading_ids, lines, leading_words, clip_duration)
            repaired.update(filled)
            repaired_lines += len(filled)

    # Fill a short trailing lyric run if vocals continue after the last anchor.
    last_id = anchors[-1]
    last = repaired[last_id]
    if last_id < len(lines) - 1 and last.end < clip_duration - 0.6:
        trailing_ids = list(range(last_id + 1, min(len(lines), last_id + 5)))
        trailing_words = _word_slice(recognized_words, max(0.0, last.end - 0.05), clip_duration)
        if trailing_words:
            filled = _split_lines_over_words(trailing_ids, lines, trailing_words, clip_duration)
            repaired.update(filled)
            repaired_lines += len(filled)

    return repaired, {
        'repaired_lines': repaired_lines,
        'instrumental_gaps': preserved_instrumental_gaps,
    }


def align_lyrics_smart_v2(
    audio_path: str,
    lyrics_text: str,
    workdir: str,
    clip_start_sec: float,
    clip_duration_sec: float,
    audio_total_sec: float,
    language: str = 'vi',
    model_name: str = 'small',
) -> tuple[list[TimedLine], float, dict]:
    lines = _lyrics_lines(lyrics_text)
    if not lines:
        return [], 0.0, {'reason': 'no_lyrics', 'engine': 'smart_v2'}

    clip_wav = str(Path(workdir) / 'smart-sub-v2-clip.wav')
    extract_audio_clip(audio_path, clip_wav, clip_start_sec, clip_duration_sec)
    recognized_words = _transcribe_words(clip_wav, lyrics_text, language, model_name)
    if not recognized_words:
        return [], 0.0, {'reason': 'no_recognized_words', 'engine': 'smart_v2'}

    expected_tokens, owners = _flatten_expected(lines)
    recognized_tokens = [word['token'] for word in recognized_words]
    prior_ratio = clip_start_sec / audio_total_sec if audio_total_sec > 0 else 0.0
    start, end, window_score = _best_window(expected_tokens, recognized_tokens, prior_ratio)
    mapping, align_conf = _align_tokens(expected_tokens[start:end], recognized_tokens)

    line_hits: dict[int, list[tuple[dict, float]]] = {}
    for local_i, (rec_i, similarity) in mapping.items():
        global_i = start + local_i
        if global_i >= len(owners) or rec_i >= len(recognized_words):
            continue
        line_id = owners[global_i]
        line_hits.setdefault(line_id, []).append((recognized_words[rec_i], similarity))

    direct: dict[int, TimedLine] = {}
    for line_id, hits in line_hits.items():
        event = _direct_event(lines[line_id], hits)
        if event:
            direct[line_id] = event

    avg_word_prob = sum(float(word.get('probability', 0.0) or 0.0) for word in recognized_words) / max(1, len(recognized_words))
    confidence = max(0.0, min(1.0, 0.58 * align_conf + 0.22 * max(0.0, window_score) + 0.20 * avg_word_prob))

    if not direct:
        fallback = _fallback_vocal_timing(lines, recognized_words, clip_start_sec, clip_duration_sec, audio_total_sec)
        return fallback, confidence, {
            'engine': 'smart_v2',
            'fallback_used': 'vocal_timing' if fallback else '',
            'recognized_words': len(recognized_words),
            'average_word_probability': round(avg_word_prob, 4),
            'timed_lines': len(fallback),
        }

    repaired, repair_diag = _repair_local_gaps(lines, direct, recognized_words, clip_duration_sec)
    final = sorted(repaired.values(), key=lambda event: (event.start, event.end))

    # If the result is still sparse, use the existing vocal-timing fallback rather than
    # returning a timeline with a large unexplained subtitle hole.
    vocal_span = max(0.1, float(recognized_words[-1]['end']) - float(recognized_words[0]['start']))
    covered = sum(max(0.0, event.end - event.start) for event in final)
    coverage_ratio = min(1.0, covered / vocal_span)
    fallback_used = ''
    if confidence < 0.30 or coverage_ratio < 0.34:
        fallback = _fallback_vocal_timing(lines, recognized_words, clip_start_sec, clip_duration_sec, audio_total_sec)
        if fallback and len(fallback) >= len(final):
            final = fallback
            fallback_used = 'vocal_timing'

    diagnostics = {
        'engine': 'smart_v2',
        'recognized_words': len(recognized_words),
        'expected_tokens': len(expected_tokens),
        'window_start_token': start,
        'window_end_token': end,
        'window_score': round(window_score, 4),
        'alignment_confidence': round(align_conf, 4),
        'average_word_probability': round(avg_word_prob, 4),
        'timed_lines': len(final),
        'vocal_coverage_ratio': round(coverage_ratio, 4),
        **repair_diag,
    }
    if fallback_used:
        diagnostics['fallback_used'] = fallback_used
    return final, confidence, diagnostics
