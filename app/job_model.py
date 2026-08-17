from dataclasses import dataclass
from typing import Any

from app.presets import resolve_preset


@dataclass
class RenderJob:
    job_id: str
    image_key: str
    audio_key: str
    output_key: str
    aspect_ratio: str
    quality: str
    fps: int
    duration_sec: float
    lyrics_source: str
    lyrics_key: str
    lyrics_text: str
    render_lyrics: bool
    use_lyrics_for_analysis: bool
    width: int
    height: int


def parse_render_job(data: dict[str, Any]) -> RenderJob:
    job_id = str(data.get('job_id', '')).strip()
    if not job_id:
        raise ValueError('job_id is required')

    image_key = str(data.get('image_key', '')).strip()
    if not image_key:
        raise ValueError('image_key is required')

    audio_key = str(data.get('audio_key', '')).strip()
    aspect_ratio = str(data.get('aspect_ratio', '9:16')).strip()
    quality = str(data.get('quality', '1080')).strip().lower()
    width, height = resolve_preset(aspect_ratio, quality)

    output_key = str(data.get('output_key', '')).strip() or f'output/{job_id}.mp4'
    fps = int(data.get('fps', 30) or 30)
    duration_sec = float(data.get('duration_sec', 0) or 0)

    lyrics = data.get('lyrics') or {}
    lyrics_source = str(lyrics.get('source', 'auto')).strip().lower()
    if lyrics_source not in {'auto', 'metadata', 'r2', 'pasted', 'none'}:
        raise ValueError(f'Unsupported lyrics source: {lyrics_source}')

    return RenderJob(
        job_id=job_id,
        image_key=image_key,
        audio_key=audio_key,
        output_key=output_key,
        aspect_ratio=aspect_ratio,
        quality=quality,
        fps=fps,
        duration_sec=duration_sec,
        lyrics_source=lyrics_source,
        lyrics_key=str(lyrics.get('key', '')).strip(),
        lyrics_text=str(lyrics.get('text', '') or ''),
        render_lyrics=bool(lyrics.get('render', False)),
        use_lyrics_for_analysis=bool(lyrics.get('use_for_analysis', True)),
        width=width,
        height=height,
    )
