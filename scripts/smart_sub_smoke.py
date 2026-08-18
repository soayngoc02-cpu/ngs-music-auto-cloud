import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.lyrics import extract_embedded_lyrics
from app.music_dna import probe_audio
from app.r2 import download, list_keys
from app.smart_subtitles import align_lyrics_smart, generate_ass_from_timed_lines

AUDIO_EXTS = ('.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg')


def main() -> int:
    keys = [k for k in list_keys('music/original/') if k.lower().endswith(AUDIO_EXTS) and '/_smoke' not in k]
    if not keys:
        raise RuntimeError('No real audio found in music/original/')

    with tempfile.TemporaryDirectory(prefix='ngs-smart-sub-smoke-') as tmp:
        tmpdir = Path(tmp)
        picked = None
        audio_path = None
        lyrics = ''
        for idx, key in enumerate(keys[:12]):
            suffix = Path(key).suffix or '.mp3'
            local = tmpdir / f'track-{idx}{suffix}'
            download(key, str(local))
            text = extract_embedded_lyrics(str(local)).strip()
            if text:
                picked = key
                audio_path = local
                lyrics = text
                break
        if not picked or not audio_path:
            raise RuntimeError('No uploaded track with embedded lyrics found for smart subtitle smoke test')

        probe = probe_audio(str(audio_path))
        total = float(probe.get('duration_sec', 0) or 0)
        if total <= 0:
            raise RuntimeError('Could not determine audio duration')
        duration = min(22.0, total)
        start = max(0.0, min(total * 0.22, max(0.0, total - duration)))

        events, confidence, diagnostics = align_lyrics_smart(
            audio_path=str(audio_path),
            lyrics_text=lyrics,
            workdir=str(tmpdir),
            clip_start_sec=start,
            clip_duration_sec=duration,
            audio_total_sec=total,
            language='vi',
            model_name='small',
        )

        print('SMART SUB TRACK:', picked)
        print('SMART SUB CLIP:', round(start, 3), '->', round(start + duration, 3))
        print('SMART SUB CONFIDENCE:', round(confidence, 4))
        print('SMART SUB DIAGNOSTICS:', diagnostics)
        for event in events[:8]:
            print(f'  {event.start:.2f}-{event.end:.2f}: {event.text}')

        if not events:
            raise RuntimeError('Smart subtitle produced no timed lyric events')

        ass = tmpdir / 'smart.ass'
        count = generate_ass_from_timed_lines(
            events,
            str(ass),
            width=1080,
            height=1920,
            style_name='tiktok_pop',
            animation='pop',
            position='bottom',
            size='large',
        )
        if count <= 0 or not ass.exists():
            raise RuntimeError('Smart subtitle ASS generation failed')
        print('SMART SUB ASS EVENTS:', count)
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
