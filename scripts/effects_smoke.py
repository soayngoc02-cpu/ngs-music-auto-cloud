import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.render import render_still
from app.subtitles import generate_ass


def run(cmd):
    subprocess.run(cmd, check=True)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='ngs-fx-smoke-') as tmp:
        root = Path(tmp)
        image = root / 'image.jpg'
        audio = root / 'audio.wav'
        ass = root / 'sub.ass'

        run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=0x263250:s=640x640:d=1', '-frames:v', '1', str(image)])
        run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.2', '-c:a', 'pcm_s16le', str(audio)])
        events = generate_ass(
            lyrics_text='Ngày tháng ấy mình từng thương nhau\nThanh xuân như mây trôi qua',
            output_path=str(ass), width=360, height=640, clip_duration_sec=2.0,
            style_name='tiktok_pop', animation='pop', position='bottom', size='large',
        )
        if events <= 0:
            raise RuntimeError('Subtitle generator returned no events')

        for effect in ['zoom_in', 'pan_right', 'cinematic', 'film_grain', 'dynamic_mix']:
            output = root / f'{effect}.mp4'
            resolved = render_still(
                str(image), str(audio), str(output), width=360, height=640, fps=24,
                duration_sec=2.0, visual_effect_mode='manual', visual_effect_preset=effect,
                visual_effect_intensity=0.7, effect_seed='smoke', subtitle_path=str(ass),
            )
            if resolved != effect or not output.exists() or output.stat().st_size < 1000:
                raise RuntimeError(f'Invalid output for {effect}')
            run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'default=nw=1', str(output)])
            print('FX OK:', effect, output.stat().st_size)

    print('Effects + subtitles smoke test OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
