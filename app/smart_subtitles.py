import math
import os
import re
import subprocess
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from app.subtitles import STYLE_PRESETS, _animation_tag, _ass_time, _escape_ass


TAG_LINE = re.compile(r'^\s*\[[^\]]+\]\s*$')
LRC_LINE = re.compile(r'^\s*\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]\s*(.*?)\s*$')
PLAIN_TIME_LINE = re.compile(r'^\s*(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\s*[-–—:]?\s*(.*?)\s*$')
TOKEN_RE = re.compile(r"[\wÀ-ỹĐđ]+", re.UNICODE)


@dataclass
class TimedLine:
    text: str
    start: float
    end: float
    confidence: float = 1.0


def _strip_accents(value: str) -> str:
    value = value.replace('đ', 'd').replace('Đ', 'D')
    return ''.join(c for c in unicodedata.normalize('NFD', value) if unicodedata.category(c) != 'Mn')


def _normalize_token(value: str) -> str:
    value = unicodedata.normalize('NFKC', str(value or '')).lower().strip()
    value = re.sub(r'[^\wÀ-ỹĐđ]+', '', value, flags=re.UNICODE)
    return _strip_accents(value)


def _lyrics_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw in (text or '').replace('\r', '').split('\n'):
        line = raw.strip()
        if not line or TAG_LINE.fullmatch(line):
            continue
        m = LRC_LINE.match(line) or PLAIN_TIME_LINE.match(line)
        if m:
            line = m.group(3).strip()
        if line:
            lines.append(line)
    return lines


def parse_timed_lyrics(text: str, clip_start_sec: float, clip_duration_sec: float) -> list[TimedLine]:
    points: list[tuple[float, str]] = []
    for raw in (text or '').replace('\r', '').split('\n'):
        line = raw.strip()
        if not line:
            continue
        m = LRC_LINE.match(line) or PLAIN_TIME_LINE.match(line)
        if not m:
            continue
        minute = int(m.group(1))
        second = float(m.group(2))
        lyric = m.group(3).strip()
        if not lyric:
            continue
        points.append((minute * 60.0 + second, lyric))
    if not points:
        return []
    points.sort(key=lambda item: item[0])
    clip_end = clip_start_sec + clip_duration_sec
    out: list[TimedLine] = []
    for idx, (start_abs, lyric) in enumerate(points):
        end_abs = points[idx + 1][0] if idx + 1 < len(points) else start_abs + 4.0
        if end_abs <= clip_start_sec or start_abs >= clip_end:
            continue
        start = max(0.0, start_abs - clip_start_sec)
        end = min(clip_duration_sec, end_abs - clip_start_sec)
        if end - start >= 0.12:
            out.append(TimedLine(lyric, start, end, 1.0))
    return out


def extract_audio_clip(audio_path: str, out_wav: str, start_sec: float, duration_sec: float) -> str:
    Path(out_wav).parent.mkdir(parents=True, exist_ok=True)
    cmd = ['ffmpeg', '-y']
    if start_sec > 0:
        cmd += ['-ss', f'{start_sec:.3f}']
    cmd += ['-i', audio_path]
    if duration_sec > 0:
        cmd += ['-t', f'{duration_sec:.3f}']
    cmd += ['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out_wav]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out_wav


def _transcribe_words(audio_clip: str, lyrics_text: str, language: str, model_name: str) -> list[dict]:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError('Smart subtitle dependency faster-whisper is not installed') from exc

    threads = max(1, min(8, os.cpu_count() or 4))
    model = WhisperModel(model_name, device='cpu', compute_type='int8', cpu_threads=threads)
    prompt = ' '.join(_lyrics_lines(lyrics_text))[:3500]
    segments, _info = model.transcribe(
        audio_clip,
        language=language or 'vi',
        beam_size=5,
        best_of=5,
        temperature=0.0,
        condition_on_previous_text=False,
        word_timestamps=True,
        vad_filter=False,
        initial_prompt=prompt or None,
    )
    words: list[dict] = []
    for segment in segments:
        for word in segment.words or []:
            token = _normalize_token(word.word)
            if not token:
                continue
            words.append({
                'raw': word.word.strip(),
                'token': token,
                'start': float(word.start),
                'end': float(word.end),
                'probability': float(getattr(word, 'probability', 0.0) or 0.0),
            })
    return words


def _token_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if len(a) <= 2 or len(b) <= 2:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _flatten_expected(lines: list[str]) -> tuple[list[str], list[int]]:
    tokens: list[str] = []
    owners: list[int] = []
    for line_i, line in enumerate(lines):
        for raw in TOKEN_RE.findall(line):
            token = _normalize_token(raw)
            if token:
                tokens.append(token)
                owners.append(line_i)
    return tokens, owners


def _best_window(expected: list[str], recognized: list[str], prior_ratio: float) -> tuple[int, int, float]:
    if not expected or not recognized:
        return 0, len(expected), 0.0
    n = len(expected)
    r = len(recognized)
    target_start = int(max(0.0, min(1.0, prior_ratio)) * n)
    lengths = sorted({max(4, min(n, int(r * factor))) for factor in (0.75, 0.9, 1.0, 1.15, 1.35, 1.6)})
    best = (0, min(n, max(r, 1)), -1.0)
    step = 1 if n <= 350 else max(1, n // 220)
    for length in lengths:
        if length >= n:
            starts = [0]
        else:
            starts = range(0, n - length + 1, step)
        for start in starts:
            window = expected[start:start + length]
            ratio = SequenceMatcher(None, window, recognized, autojunk=False).ratio()
            distance = abs(start - target_start) / max(1, n)
            score = ratio - 0.12 * distance
            if score > best[2]:
                best = (start, start + length, score)
    return best


def _align_tokens(expected: list[str], recognized: list[str]) -> tuple[dict[int, tuple[int, float]], float]:
    n, m = len(expected), len(recognized)
    if not n or not m:
        return {}, 0.0
    delete_cost = 0.72
    insert_cost = 0.68
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    bt = [[''] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = i * delete_cost
        bt[i][0] = 'D'
    for j in range(1, m + 1):
        dp[0][j] = j * insert_cost
        bt[0][j] = 'I'
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            sim = _token_similarity(expected[i - 1], recognized[j - 1])
            subst = 1.0 - sim if sim >= 0.38 else 1.05
            choices = (
                (dp[i - 1][j - 1] + subst, 'M'),
                (dp[i - 1][j] + delete_cost, 'D'),
                (dp[i][j - 1] + insert_cost, 'I'),
            )
            dp[i][j], bt[i][j] = min(choices, key=lambda item: item[0])
    mapping: dict[int, tuple[int, float]] = {}
    similarities: list[float] = []
    i, j = n, m
    while i > 0 or j > 0:
        op = bt[i][j]
        if op == 'M' and i > 0 and j > 0:
            sim = _token_similarity(expected[i - 1], recognized[j - 1])
            if sim >= 0.48:
                mapping[i - 1] = (j - 1, sim)
                similarities.append(sim)
            i -= 1
            j -= 1
        elif op == 'D' and i > 0:
            i -= 1
        elif j > 0:
            j -= 1
        else:
            break
    rec_coverage = len({j for j, _ in mapping.values()}) / max(1, m)
    exp_coverage = len(mapping) / max(1, n)
    avg_sim = sum(similarities) / max(1, len(similarities))
    confidence = 0.45 * rec_coverage + 0.25 * exp_coverage + 0.30 * avg_sim
    return mapping, confidence


def _interpolate_missing(events: list[TimedLine | None], clip_duration_sec: float) -> list[TimedLine]:
    out = list(events)
    known = [i for i, event in enumerate(out) if event is not None]
    if not known:
        return []
    for left, right in zip(known, known[1:]):
        gap = right - left - 1
        if gap <= 0 or gap > 2:
            continue
        left_event = out[left]
        right_event = out[right]
        assert left_event is not None and right_event is not None
        free_start = max(left_event.end, left_event.start + 0.1)
        free_end = max(free_start, right_event.start)
        slot = (free_end - free_start) / (gap + 1) if free_end > free_start else 0.0
        for offset in range(1, gap + 1):
            idx = left + offset
            if slot <= 0.12:
                continue
            start = free_start + slot * (offset - 1)
            end = min(free_end, start + slot * 0.92)
            original = events[idx]
            text = original.text if original is not None else ''
            if text:
                out[idx] = TimedLine(text, start, end, 0.25)
    cleaned: list[TimedLine] = []
    prev_end = 0.0
    for event in out:
        if event is None or not event.text:
            continue
        start = max(0.0, event.start)
        end = min(clip_duration_sec, max(start + 0.18, event.end))
        if start < prev_end - 0.18:
            start = max(0.0, prev_end - 0.08)
        if end <= start + 0.08:
            end = min(clip_duration_sec, start + 0.35)
        if start >= clip_duration_sec or end <= 0:
            continue
        cleaned.append(TimedLine(event.text, start, end, event.confidence))
        prev_end = max(prev_end, end)
    return cleaned


def align_lyrics_smart(
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
        return [], 0.0, {'reason': 'no_lyrics'}
    clip_wav = str(Path(workdir) / 'smart-sub-clip.wav')
    extract_audio_clip(audio_path, clip_wav, clip_start_sec, clip_duration_sec)
    recognized_words = _transcribe_words(clip_wav, lyrics_text, language, model_name)
    if not recognized_words:
        return [], 0.0, {'reason': 'no_recognized_words'}

    expected_tokens, owners = _flatten_expected(lines)
    recognized_tokens = [word['token'] for word in recognized_words]
    prior_ratio = clip_start_sec / audio_total_sec if audio_total_sec > 0 else 0.0
    start, end, window_score = _best_window(expected_tokens, recognized_tokens, prior_ratio)
    window_tokens = expected_tokens[start:end]
    mapping, align_conf = _align_tokens(window_tokens, recognized_tokens)

    line_word_hits: dict[int, list[tuple[dict, float]]] = {}
    for local_i, (rec_i, sim) in mapping.items():
        global_i = start + local_i
        if global_i >= len(owners) or rec_i >= len(recognized_words):
            continue
        line_i = owners[global_i]
        line_word_hits.setdefault(line_i, []).append((recognized_words[rec_i], sim))

    candidate_line_ids = sorted(line_word_hits)
    if not candidate_line_ids:
        return [], 0.0, {
            'reason': 'no_line_matches', 'window_score': window_score, 'alignment_confidence': align_conf,
        }
    first_line = max(0, candidate_line_ids[0] - 1)
    last_line = min(len(lines) - 1, candidate_line_ids[-1] + 1)
    events: list[TimedLine | None] = []
    for line_i in range(first_line, last_line + 1):
        hits = line_word_hits.get(line_i, [])
        if hits:
            words = [item[0] for item in hits]
            sims = [item[1] for item in hits]
            start_t = min(word['start'] for word in words)
            end_t = max(word['end'] for word in words)
            conf = sum(sims) / max(1, len(sims))
            events.append(TimedLine(lines[line_i], start_t, max(end_t, start_t + 0.25), conf))
        else:
            events.append(TimedLine(lines[line_i], 0.0, 0.0, 0.0))

    nullable: list[TimedLine | None] = [event if event.confidence > 0 else None for event in events]
    # Preserve text for short gaps so interpolation can fill only between reliable anchors.
    for idx, event in enumerate(events):
        if nullable[idx] is None:
            nullable[idx] = TimedLine(event.text, 0.0, 0.0, 0.0)
    # Interpolation helper expects actual None for unknown timings, so use a parallel pass.
    temp: list[TimedLine | None] = []
    for event in events:
        temp.append(event if event.confidence > 0 else None)
    aligned = _interpolate_missing(temp, clip_duration_sec)

    # Add unmatched line text back only for reliable matched lines; this deliberately avoids guessing long gaps.
    matched_by_text = {event.text: event for event in aligned}
    final: list[TimedLine] = []
    for line_i in range(first_line, last_line + 1):
        text = lines[line_i]
        if text in matched_by_text:
            final.append(matched_by_text[text])
            continue
        hits = line_word_hits.get(line_i, [])
        if hits:
            words = [item[0] for item in hits]
            sims = [item[1] for item in hits]
            final.append(TimedLine(
                text,
                min(word['start'] for word in words),
                max(word['end'] for word in words),
                sum(sims) / max(1, len(sims)),
            ))
    final.sort(key=lambda event: (event.start, event.end))

    avg_word_prob = sum(word['probability'] for word in recognized_words) / max(1, len(recognized_words))
    final_conf = max(0.0, min(1.0, 0.58 * align_conf + 0.22 * max(0.0, window_score) + 0.20 * avg_word_prob))
    diagnostics = {
        'recognized_words': len(recognized_words),
        'expected_tokens': len(expected_tokens),
        'window_start_token': start,
        'window_end_token': end,
        'window_score': round(window_score, 4),
        'alignment_confidence': round(align_conf, 4),
        'average_word_probability': round(avg_word_prob, 4),
        'timed_lines': len(final),
    }
    return final, final_conf, diagnostics


def generate_ass_from_timed_lines(
    events: list[TimedLine],
    output_path: str,
    width: int,
    height: int,
    style_name: str = 'clean_pro',
    animation: str = 'fade',
    position: str = 'bottom',
    size: str = 'large',
) -> int:
    if not events:
        return 0
    style = STYLE_PRESETS.get(style_name, STYLE_PRESETS['clean_pro'])
    size_factor = {'medium': 0.88, 'large': 1.0, 'xlarge': 1.18}.get(size, 1.0)
    font_size = max(28, int(height * 0.038 * style['scale'] * size_factor))
    alignment = {'top': 8, 'center': 5, 'bottom': 2}.get(position, 2)
    margin_v = int(height * ({'top': 0.075, 'center': 0.04, 'bottom': 0.075}.get(position, 0.075)))
    margin_h = max(24, int(width * 0.06))
    header = f'''[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,{font_size},{style['primary']},{style['primary']},{style['outline']},{style['back']},{style['bold']},0,0,0,100,100,0,0,{style['border']},{style['outline_w']},{style['shadow']},{alignment},{margin_h},{margin_h},{margin_v},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'''
    rows: list[str] = []
    for event in events:
        if not event.text or event.end <= event.start:
            continue
        tag = _animation_tag(animation, width, height, position)
        rows.append(
            f'Dialogue: 0,{_ass_time(event.start)},{_ass_time(event.end)},Default,,0,0,0,,{tag}{_escape_ass(event.text)}'
        )
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(header + '\n'.join(rows) + '\n', encoding='utf-8-sig')
    return len(rows)
