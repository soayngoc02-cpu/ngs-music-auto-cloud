import json
import sys
import tempfile
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.job_model import parse_render_job
from app.lyrics import load_lyrics
from app.music_selector import choose
from app.r2 import download, list_keys, upload
from app.render import render_still


def select_audio_from_dna(tmpdir: Path, rules_path: str = 'config/music_rules.json') -> str:
    dna_keys = [k for k in list_keys('music/dna/') if k.lower().endswith('.json')]
    if not dna_keys:
        raise RuntimeError('No Music DNA files found in R2. Run Music DNA ingest first.')

    local_dna = []
    for idx, key in enumerate(dna_keys):
        local = tmpdir / 'dna' / f'{idx:05d}.json'
        download(key, str(local))
        local_dna.append(str(local))

    picked = choose(local_dna, rules_path)
    audio_key = str(picked.get('r2_key', '')).strip()
    if not audio_key:
        raise RuntimeError('Selected Music DNA has no r2_key')
    return audio_key


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def main() -> int:
    if len(sys.argv) != 2:
        print('Usage: python scripts/render_from_job.py jobs/pending/C001.json')
        return 2

    job_key = sys.argv[1]
    fallback_id = Path(job_key).stem

    with tempfile.TemporaryDirectory(prefix='ngs-job-') as tmp:
        tmpdir = Path(tmp)
        local_job = tmpdir / 'job.json'
        download(job_key, str(local_job))
        raw = json.loads(local_job.read_text(encoding='utf-8'))
        job = parse_render_job(raw)

        try:
            audio_key = job.audio_key or select_audio_from_dna(tmpdir)
            image_suffix = Path(job.image_key).suffix or '.jpg'
            audio_suffix = Path(audio_key).suffix or '.mp3'
            local_image = tmpdir / f'image{image_suffix}'
            local_audio = tmpdir / f'audio{audio_suffix}'
            local_output = tmpdir / 'output.mp4'

            print('JOB:', job.job_id)
            print('IMAGE:', job.image_key)
            print('AUDIO:', audio_key)
            print('PRESET:', job.aspect_ratio, job.quality, f'{job.width}x{job.height}', f'{job.fps}fps')

            download(job.image_key, str(local_image))
            download(audio_key, str(local_audio))

            local_lyrics = None
            if job.lyrics_source == 'r2':
                if not job.lyrics_key:
                    raise ValueError('lyrics.key is required when lyrics.source=r2')
                local_lyrics = tmpdir / 'lyrics.txt'
                download(job.lyrics_key, str(local_lyrics))

            pasted = job.lyrics_text if job.lyrics_source == 'pasted' else None
            lyrics_text, detected_source = load_lyrics(
                str(local_audio),
                str(local_lyrics) if local_lyrics else None,
                pasted,
            )
            if job.lyrics_source == 'none':
                lyrics_text, detected_source = '', 'none'
            elif job.lyrics_source == 'metadata' and detected_source != 'metadata':
                raise RuntimeError('No embedded lyrics found in audio metadata')

            extracted_lyrics_key = ''
            if lyrics_text:
                lyrics_file = tmpdir / 'extracted_lyrics.txt'
                lyrics_file.write_text(lyrics_text, encoding='utf-8')
                extracted_lyrics_key = f'lyrics/extracted/{job.job_id}.txt'
                upload(str(lyrics_file), extracted_lyrics_key)
                print('LYRICS:', detected_source, extracted_lyrics_key)
            else:
                print('LYRICS: none')

            if job.render_lyrics:
                print('NOTE: render_lyrics requested; V1 stores/extracts lyrics but does not burn timed lyrics yet.')

            render_still(
                str(local_image),
                str(local_audio),
                str(local_output),
                width=job.width,
                height=job.height,
                fps=job.fps,
                duration_sec=job.duration_sec if job.duration_sec > 0 else None,
            )
            upload(str(local_output), job.output_key)

            done = {
                **raw,
                'job_id': job.job_id,
                'status': 'done',
                'selected_audio_key': audio_key,
                'resolved_width': job.width,
                'resolved_height': job.height,
                'resolved_fps': job.fps,
                'lyrics_detected_source': detected_source,
                'extracted_lyrics_key': extracted_lyrics_key,
                'output_key': job.output_key,
            }
            done_file = tmpdir / 'done.json'
            write_json(done_file, done)
            done_key = f'jobs/done/{job.job_id}.json'
            upload(str(done_file), done_key)
            print('RENDER JOB OK:', job.output_key)
            print('DONE STATUS:', done_key)
            return 0

        except Exception as exc:
            failed = {
                **raw,
                'job_id': getattr(job, 'job_id', fallback_id),
                'status': 'failed',
                'error': str(exc),
                'traceback': traceback.format_exc(),
            }
            failed_file = tmpdir / 'failed.json'
            write_json(failed_file, failed)
            failed_key = f"jobs/failed/{failed['job_id']}.json"
            try:
                upload(str(failed_file), failed_key)
                print('FAILED STATUS:', failed_key)
            finally:
                raise


if __name__ == '__main__':
    raise SystemExit(main())
