import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.r2 import download, upload

IMAGE_KEY = 'images/_smoke.png'
AUDIO_KEY = 'music/original/_smoke.wav'
OUTPUT_KEY = 'output/_smoke.mp4'


def run(cmd: list[str]) -> None:
    print('+', ' '.join(cmd))
    subprocess.run(cmd, check=True)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='ngs-e2e-') as tmp:
        tmpdir = Path(tmp)
        image = tmpdir / 'smoke.png'
        audio = tmpdir / 'smoke.wav'
        result = tmpdir / 'result.mp4'

        run([
            'ffmpeg', '-y', '-f', 'lavfi', '-i',
            'color=c=0x202020:s=1080x1920:d=1',
            '-frames:v', '1', str(image)
        ])
        run([
            'ffmpeg', '-y', '-f', 'lavfi', '-i',
            'sine=frequency=440:sample_rate=44100:duration=3',
            '-c:a', 'pcm_s16le', str(audio)
        ])

        upload(str(image), IMAGE_KEY)
        upload(str(audio), AUDIO_KEY)
        print('Smoke inputs uploaded to R2')

        run([sys.executable, 'scripts/ingest_music.py', '--key', AUDIO_KEY])
        run([
            sys.executable, 'scripts/render_job.py',
            '--image-key', IMAGE_KEY,
            '--output-key', OUTPUT_KEY,
            '--width', '1080', '--height', '1920', '--fps', '30'
        ])

        download(OUTPUT_KEY, str(result))
        probe = subprocess.check_output([
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration,size',
            '-of', 'json', str(result)
        ], text=True)
        info = json.loads(probe).get('format', {})
        duration = float(info.get('duration', 0) or 0)
        size = int(info.get('size', 0) or 0)
        if duration < 2.5 or size <= 0:
            raise RuntimeError(f'Bad smoke render: duration={duration} size={size}')

        print(f'E2E RENDER OK: {OUTPUT_KEY}')
        print(f'Duration: {duration:.3f}s')
        print(f'Size: {size} bytes')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
