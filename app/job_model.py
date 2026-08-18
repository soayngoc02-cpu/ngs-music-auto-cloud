from dataclasses import dataclass
from typing import Any

from app.presets import resolve_preset
from app.render import VISUAL_EFFECTS
from app.subtitles import STYLE_PRESETS


SUBTITLE_ANIMATIONS = {'fade', 'pop', 'slide_up', 'pulse', 'none'}
SUBTITLE_POSITIONS = {'top', 'center', 'bottom'}
SUBTITLE_SIZES = {'medium', 'large', 'xlarge'}
SUBTITLE_SYNC_MODES = {'smart', 'timed', 'basic'}
SUBTITLE_MODELS = {'base', 'small'}


@dataclass
class RenderJob:
    job_id: str
    image_key: str
    audio_key: str
    output_key: str
    music_mode: str
    audio_start_sec: float
    aspect_ratio: str
    quality: str
    fps: int
    duration_sec: float
    lyrics_source: str
    lyrics_key: str
    lyrics_text: str
    render_lyrics: bool
    use_lyrics_for_analysis: bool
    visual_effect_mode: str
    visual_effect_preset: str
    visual_effect_intensity: float
    subtitle_enabled: bool
    subtitle_style: str
    subtitle_animation: str
    subtitle_position: str
    subtitle_size: str
    subtitle_max_lines: int
    subtitle_sync_mode: str
    subtitle_language: str
    subtitle_model: str
    subtitle_min_confidence: float
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
    music_mode = str(data.get('music_mode', 'file' if audio_key else 'auto')).strip().lower()
    if music_mode not in {'auto', 'file', 'manual'}:
        raise ValueError(f'Unsupported music_mode: {music_mode}')

    audio_start_sec = float(data.get('audio_start_sec', 0) or 0)
    if audio_start_sec < 0:
        raise ValueError('audio_start_sec cannot be negative')

    aspect_ratio = str(data.get('aspect_ratio', '9:16')).strip()
    quality = str(data.get('quality', '1080')).strip().lower()
    width, height = resolve_preset(aspect_ratio, quality)

    output_key = str(data.get('output_key', '')).strip() or f'output/{job_id}.mp4'
    fps = int(data.get('fps', 30) or 30)
    duration_sec = float(data.get('duration_sec', 0) or 0)
    if duration_sec < 0:
        raise ValueError('duration_sec cannot be negative')
    if music_mode == 'manual' and duration_sec <= 0:
        raise ValueError('Manual music trim requires duration_sec > 0')

    lyrics = data.get('lyrics') or {}
    lyrics_source = str(lyrics.get('source', 'auto')).strip().lower()
    if lyrics_source not in {'auto', 'metadata', 'r2', 'pasted', 'none'}:
        raise ValueError(f'Unsupported lyrics source: {lyrics_source}')

    visual = data.get('visual_effect') or {}
    visual_effect_mode = str(visual.get('mode', 'auto')).strip().lower()
    if visual_effect_mode not in {'auto', 'manual'}:
        visual_effect_mode = 'auto'
    visual_effect_preset = str(visual.get('preset', 'auto')).strip().lower()
    if visual_effect_mode == 'manual' and visual_effect_preset not in VISUAL_EFFECTS:
        raise ValueError(f'Unsupported visual effect: {visual_effect_preset}')
    visual_effect_intensity = float(visual.get('intensity', 0.65) or 0.65)
    visual_effect_intensity = max(0.05, min(1.0, visual_effect_intensity))

    subtitle = data.get('subtitle') or {}
    subtitle_enabled = bool(subtitle.get('enabled', lyrics.get('render', False)))
    subtitle_style = str(subtitle.get('style', 'clean_pro')).strip().lower()
    if subtitle_style not in STYLE_PRESETS:
        subtitle_style = 'clean_pro'
    subtitle_animation = str(subtitle.get('animation', 'fade')).strip().lower()
    if subtitle_animation not in SUBTITLE_ANIMATIONS:
        subtitle_animation = 'fade'
    subtitle_position = str(subtitle.get('position', 'bottom')).strip().lower()
    if subtitle_position not in SUBTITLE_POSITIONS:
        subtitle_position = 'bottom'
    subtitle_size = str(subtitle.get('size', 'large')).strip().lower()
    if subtitle_size not in SUBTITLE_SIZES:
        subtitle_size = 'large'
    subtitle_max_lines = max(1, min(3, int(subtitle.get('max_lines', 2) or 2)))
    subtitle_sync_mode = str(subtitle.get('sync_mode', 'smart')).strip().lower()
    if subtitle_sync_mode not in SUBTITLE_SYNC_MODES:
        subtitle_sync_mode = 'smart'
    subtitle_language = str(subtitle.get('language', 'vi')).strip().lower() or 'vi'
    subtitle_model = str(subtitle.get('model', 'small')).strip().lower()
    if subtitle_model not in SUBTITLE_MODELS:
        subtitle_model = 'small'
    subtitle_min_confidence = float(subtitle.get('min_confidence', 0.38) or 0.38)
    subtitle_min_confidence = max(0.15, min(0.90, subtitle_min_confidence))

    return RenderJob(
        job_id=job_id,
        image_key=image_key,
        audio_key=audio_key,
        output_key=output_key,
        music_mode=music_mode,
        audio_start_sec=audio_start_sec,
        aspect_ratio=aspect_ratio,
        quality=quality,
        fps=fps,
        duration_sec=duration_sec,
        lyrics_source=lyrics_source,
        lyrics_key=str(lyrics.get('key', '')).strip(),
        lyrics_text=str(lyrics.get('text', '') or ''),
        render_lyrics=bool(lyrics.get('render', False)),
        use_lyrics_for_analysis=bool(lyrics.get('use_for_analysis', True)),
        visual_effect_mode=visual_effect_mode,
        visual_effect_preset=visual_effect_preset,
        visual_effect_intensity=visual_effect_intensity,
        subtitle_enabled=subtitle_enabled,
        subtitle_style=subtitle_style,
        subtitle_animation=subtitle_animation,
        subtitle_position=subtitle_position,
        subtitle_size=subtitle_size,
        subtitle_max_lines=subtitle_max_lines,
        subtitle_sync_mode=subtitle_sync_mode,
        subtitle_language=subtitle_language,
        subtitle_model=subtitle_model,
        subtitle_min_confidence=subtitle_min_confidence,
        width=width,
        height=height,
    )
