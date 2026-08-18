import json
import sys
import tempfile
import traceback
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.effect_selector import choose_auto_effect
from app.job_model import parse_render_job
from app.lyrics import load_lyrics
from app.music_dna import probe_audio
from app.music_selector import choose
from app.r2 import download, list_keys, upload
from app.render import render_still
from app.smart_subtitles import (
    align_lyrics_smart,
    generate_ass_from_timed_lines,
    parse_timed_lyrics,
)
from app.subtitles import generate_ass


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
            render_id = str(raw.get('render_id') or f'{job.job_id}-legacy')

            print('JOB:', job.job_id)
            print('RENDER ID:', render_id)
            print('IMAGE:', job.image_key)
            print('AUDIO:', audio_key)
            print('MUSIC MODE:', job.music_mode)
            print('AUDIO START:', job.audio_start_sec)
            print('DURATION:', job.duration_sec)
            print('VISUAL EFFECT:', job.visual_effect_mode, job.visual_effect_preset, job.visual_effect_intensity)
            print('SUBTITLE:', job.subtitle_enabled, job.subtitle_sync_mode, job.subtitle_style, job.subtitle_animation)
            print('PRESET:', job.aspect_ratio, job.quality, f'{job.width}x{job.height}', f'{job.fps}fps')

            download(job.image_key, str(local_image))
            download(audio_key, str(local_audio))

            audio_probe = probe_audio(str(local_audio))
            audio_total_sec = float(audio_probe.get('duration_sec', 0) or 0)
            if job.duration_sec > 0:
                clip_duration_sec = job.duration_sec
            elif audio_total_sec > 0:
                clip_duration_sec = max(0.5, audio_total_sec - job.audio_start_sec)
            else:
                clip_duration_sec = 0

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

            subtitle_path = None
            subtitle_events = 0
            subtitle_sync_status = 'disabled'
            subtitle_sync_confidence = 0.0
            subtitle_sync_diagnostics: dict = {}

            if job.subtitle_enabled:
                if not lyrics_text:
                    subtitle_sync_status = 'no_lyrics'
                    print('SUBTITLE SKIP: no lyrics available')
                elif clip_duration_sec <= 0:
                    subtitle_sync_status = 'no_duration'
                    print('SUBTITLE SKIP: cannot determine clip duration')
                else:
                    subtitle_file = tmpdir / 'lyrics.ass'
                    timed_events = parse_timed_lyrics(
                        lyrics_text,
                        clip_start_sec=job.audio_start_sec,
                        clip_duration_sec=clip_duration_sec,
                    )

                    if timed_events:
                        subtitle_events = generate_ass_from_timed_lines(
                            timed_events,
                            str(subtitle_file),
                            width=job.width,
                            height=job.height,
                            style_name=job.subtitle_style,
                            animation=job.subtitle_animation,
                            position=job.subtitle_position,
                            size=job.subtitle_size,
                        )
                        subtitle_sync_status = 'timed_lyrics'
                        subtitle_sync_confidence = 1.0
                        subtitle_sync_diagnostics = {'timed_lines': len(timed_events), 'source': 'embedded_timestamps'}
                        print('SUBTITLE TIMED LYRICS:', subtitle_events)
                    elif job.subtitle_sync_mode == 'smart':
                        print('SMART SUBTITLE: listening to selected audio clip...')
                        smart_events, smart_confidence, diagnostics = align_lyrics_smart(
                            audio_path=str(local_audio),
                            lyrics_text=lyrics_text,
                            workdir=str(tmpdir),
                            clip_start_sec=job.audio_start_sec,
                            clip_duration_sec=clip_duration_sec,
                            audio_total_sec=audio_total_sec,
                            language=job.subtitle_language,
                            model_name=job.subtitle_model,
                        )
                        subtitle_sync_confidence = smart_confidence
                        subtitle_sync_diagnostics = diagnostics
                        print('SMART SUBTITLE CONFIDENCE:', round(smart_confidence, 4), diagnostics)
                        if smart_events and smart_confidence >= job.subtitle_min_confidence:
                            subtitle_events = generate_ass_from_timed_lines(
                                smart_events,
                                str(subtitle_file),
                                width=job.width,
                                height=job.height,
                                style_name=job.subtitle_style,
                                animation=job.subtitle_animation,
                                position=job.subtitle_position,
                                size=job.subtitle_size,
                            )
                            subtitle_sync_status = 'smart_aligned'
                        else:
                            subtitle_sync_status = 'low_confidence'
                            print(
                                'SUBTITLE SKIP: smart alignment confidence too low; '
                                f'{smart_confidence:.3f} < {job.subtitle_min_confidence:.3f}'
                            )
                    elif job.subtitle_sync_mode == 'timed':
                        subtitle_sync_status = 'timestamps_missing'
                        print('SUBTITLE SKIP: timed mode selected but lyrics contain no timestamps')
                    else:
                        subtitle_events = generate_ass(
                            lyrics_text=lyrics_text,
                            output_path=str(subtitle_file),
                            width=job.width,
                            height=job.height,
                            clip_duration_sec=clip_duration_sec,
                            audio_total_sec=audio_total_sec,
                            audio_start_sec=job.audio_start_sec,
                            lyrics_source=detected_source,
                            style_name=job.subtitle_style,
                            animation=job.subtitle_animation,
                            position=job.subtitle_position,
                            size=job.subtitle_size,
                            max_lines=job.subtitle_max_lines,
                        )
                        subtitle_sync_status = 'basic_timeline'

                    if subtitle_events > 0 and subtitle_file.exists():
                        subtitle_path = str(subtitle_file)
                        print('SUBTITLE EVENTS:', subtitle_events, 'STATUS:', subtitle_sync_status)
                    elif subtitle_sync_status not in {'low_confidence', 'timestamps_missing'}:
                        print('SUBTITLE SKIP: no usable timed lyric lines')

            sync_record_key = ''
            if job.subtitle_enabled:
                sync_record = {
                    'job_id': job.job_id,
                    'render_id': render_id,
                    'audio_key': audio_key,
                    'audio_start_sec': job.audio_start_sec,
                    'duration_sec': clip_duration_sec,
                    'sync_mode': job.subtitle_sync_mode,
                    'status': subtitle_sync_status,
                    'confidence': subtitle_sync_confidence,
                    'events': subtitle_events,
                    'diagnostics': subtitle_sync_diagnostics,
                }
                sync_file = tmpdir / 'subtitle-sync.json'
                write_json(sync_file, sync_record)
                sync_record_key = f'lyrics/sync/{render_id}.json'
                upload(str(sync_file), sync_record_key)

            effect_mode = job.visual_effect_mode
            effect_preset = job.visual_effect_preset
            if effect_mode == 'auto':
                effect_preset = choose_auto_effect(
                    seed=render_id,
                    lyrics_text=lyrics_text,
                    duration_sec=clip_duration_sec,
                )
                effect_mode = 'manual'
                print('AUTO EFFECT CHOSEN:', effect_preset)

            resolved_effect = render_still(
                str(local_image),
                str(local_audio),
                str(local_output),
                width=job.width,
                height=job.height,
                fps=job.fps,
                duration_sec=clip_duration_sec if clip_duration_sec > 0 else None,
                audio_start_sec=job.audio_start_sec,
                visual_effect_mode=effect_mode,
                visual_effect_preset=effect_preset,
                visual_effect_intensity=job.visual_effect_intensity,
                effect_seed=render_id,
                subtitle_path=subtitle_path,
            )
            upload(str(local_output), job.output_key)

            completed_at = datetime.now(timezone.utc).isoformat()
            done = {
                **raw,
                'job_id': job.job_id,
                'render_id': render_id,
                'status': 'done',
                'completed_at': completed_at,
                'selected_audio_key': audio_key,
                'resolved_audio_start_sec': job.audio_start_sec,
                'resolved_duration_sec': clip_duration_sec,
                'resolved_width': job.width,
                'resolved_height': job.height,
                'resolved_fps': job.fps,
                'resolved_visual_effect': resolved_effect,
                'subtitle_events': subtitle_events,
                'subtitle_sync_status': subtitle_sync_status,
                'subtitle_sync_confidence': subtitle_sync_confidence,
                'subtitle_sync_record_key': sync_record_key,
                'lyrics_detected_source': detected_source,
                'extracted_lyrics_key': extracted_lyrics_key,
                'output_key': job.output_key,
            }
            done_file = tmpdir / 'done.json'
            write_json(done_file, done)

            done_key = f'jobs/done/{job.job_id}.json'
            upload(str(done_file), done_key)

            history_key = f'jobs/history/{render_id}.json'
            upload(str(done_file), history_key)

            print('RENDER JOB OK:', job.output_key)
            print('RESOLVED EFFECT:', resolved_effect)
            print('SUBTITLE SYNC:', subtitle_sync_status, round(subtitle_sync_confidence, 4))
            print('DONE STATUS:', done_key)
            print('HISTORY:', history_key)
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
