import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.music_selector import choose
from app.r2 import download, list_keys, upload
from app.render import render_still


def select_audio_from_dna(tmpdir: Path, rules_path: str) -> str:
    dna_keys = [k for k in list_keys('music/dna/') if k.lower().endswith('.json')]
    if not dna_keys:
        raise RuntimeError('No Music DNA files found in R2. Run Music DNA ingest first.')

    local_dna_files = []
    for idx, key in enumerate(dna_keys):
        local = tmpdir / 'dna' / f'{idx:05d}.json'
        download(key, str(local))
        local_dna_files.append(str(local))

    picked = choose(local_dna_files, rules_path)
    audio_key = picked.get('r2_key')
    if not audio_key:
        raise RuntimeError('Selected DNA is missing r2_key. Re-run Music DNA ingest.')
    print('Music Selector picked:', audio_key)
    print('Selected DNA:', json.dumps(picked, ensure_ascii=False))
    return audio_key


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--image-key', required=True)
    parser.add_argument('--audio-key', default='')
    parser.add_argument('--output-key', required=True)
    parser.add_argument('--rules', default='config/music_rules.json')
    parser.add_argument('--width', type=int, default=1080)
    parser.add_argument('--height', type=int, default=1920)
    parser.add_argument('--fps', type=int, default=30)
    parser.add_argument('--duration', type=float, default=0, help='Optional render duration in seconds; 0 means full audio')
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix='ngs-render-') as tmp:
        tmpdir = Path(tmp)
        image_suffix = Path(args.image_key).suffix or '.jpg'
        local_image = tmpdir / f'image{image_suffix}'
        local_output = tmpdir / 'output.mp4'

        audio_key = args.audio_key.strip() or select_audio_from_dna(tmpdir, args.rules)
        audio_suffix = Path(audio_key).suffix or '.mp3'
        local_audio = tmpdir / f'audio{audio_suffix}'

        print('Downloading image:', args.image_key)
        download(args.image_key, str(local_image))
        print('Downloading audio:', audio_key)
        download(audio_key, str(local_audio))

        print('Rendering on GitHub runner...')
        render_still(
            str(local_image),
            str(local_audio),
            str(local_output),
            width=args.width,
            height=args.height,
            fps=args.fps,
            duration_sec=args.duration if args.duration > 0 else None,
        )

        print('Uploading output:', args.output_key)
        upload(str(local_output), args.output_key)
        print('RENDER OK:', args.output_key)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
