import hashlib
import subprocess
from pathlib import Path


VISUAL_EFFECTS = {
    'none',
    'zoom_in', 'zoom_out',
    'pan_left', 'pan_right', 'pan_up', 'pan_down',
    'drift', 'pulse', 'ken_burns',
    'cinematic', 'dreamy', 'soft_glow', 'vignette', 'film_grain',
    'warm_film', 'cool_night', 'vintage', 'lofi', 'dramatic',
    'monochrome', 'dynamic_mix',
}

AUTO_EFFECTS = [
    'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'drift', 'ken_burns',
    'cinematic', 'dreamy', 'soft_glow', 'warm_film', 'lofi', 'dynamic_mix',
]


def resolve_visual_effect(mode: str, preset: str, seed: str) -> str:
    effect_mode = (mode or 'auto').strip().lower()
    requested = (preset or 'auto').strip().lower()
    if effect_mode == 'manual' and requested in VISUAL_EFFECTS:
        return requested
    digest = hashlib.sha256(str(seed or 'ngs').encode('utf-8')).digest()
    return AUTO_EFFECTS[int.from_bytes(digest[:4], 'big') % len(AUTO_EFFECTS)]


def _static_base(width: int, height: int) -> str:
    return (
        f'scale={width}:{height}:force_original_aspect_ratio=increase,'
        f'crop={width}:{height},setsar=1'
    )


def _motion_base(width: int, height: int, fps: int, duration_sec: float, effect: str, intensity: float) -> str:
    frames = max(1, int(max(0.5, duration_sec) * max(1, fps)))
    strength = max(0.05, min(1.0, intensity))
    extra = 1.18
    sw = max(width + 2, int(width * extra))
    sh = max(height + 2, int(height * extra))
    preload = (
        f'scale={sw}:{sh}:force_original_aspect_ratio=increase,'
        f'crop={sw}:{sh},setsar=1'
    )

    amp = 0.05 + 0.10 * strength
    z_const = 1.04 + 0.07 * strength
    center_x = "iw/2-(iw/zoom/2)"
    center_y = "ih/2-(ih/zoom/2)"

    if effect == 'zoom_out':
        z = f"{1 + amp:.6f}-{amp:.6f}*on/{frames}"
        x, y = center_x, center_y
    elif effect == 'pan_left':
        z = f'{z_const:.6f}'
        x = f"(iw-iw/zoom)*(1-on/{frames})"
        y = center_y
    elif effect == 'pan_right':
        z = f'{z_const:.6f}'
        x = f"(iw-iw/zoom)*(on/{frames})"
        y = center_y
    elif effect == 'pan_up':
        z = f'{z_const:.6f}'
        x = center_x
        y = f"(ih-ih/zoom)*(1-on/{frames})"
    elif effect == 'pan_down':
        z = f'{z_const:.6f}'
        x = center_x
        y = f"(ih-ih/zoom)*(on/{frames})"
    elif effect == 'drift':
        z = f'{z_const:.6f}'
        period = max(20.0, fps * (2.8 + 3.0 * (1.0 - strength)))
        x = f"(iw-iw/zoom)*(0.5+0.42*sin(on/{period:.3f}))"
        y = f"(ih-ih/zoom)*(0.5+0.32*cos(on/{period * 1.21:.3f}))"
    elif effect == 'pulse':
        period = max(12.0, fps * (1.2 + 1.4 * (1.0 - strength)))
        z = f"1.035+{0.018 + 0.02 * strength:.6f}*sin(on/{period:.3f})"
        x, y = center_x, center_y
    elif effect == 'ken_burns':
        z = f"1+{amp:.6f}*on/{frames}"
        x = f"(iw-iw/zoom)*(0.18+0.55*on/{frames})"
        y = f"(ih-ih/zoom)*(0.22+0.25*on/{frames})"
    else:
        z = f"1+{amp:.6f}*on/{frames}"
        x, y = center_x, center_y

    return (
        f"{preload},zoompan=z='{z}':x='{x}':y='{y}':d=1:"
        f's={width}x{height}:fps={fps}'
    )


def _color_suffix(effect: str, intensity: float) -> str:
    strength = max(0.05, min(1.0, intensity))
    if effect == 'cinematic':
        return f',eq=contrast={1.04 + 0.08 * strength:.3f}:saturation={1.01 + 0.08 * strength:.3f}:brightness={-0.008 * strength:.4f},vignette=PI/{6.0 - 1.5 * strength:.3f}'
    if effect == 'dreamy':
        return f',eq=saturation={0.96 + 0.06 * strength:.3f}:brightness={0.015 + 0.025 * strength:.3f}:gamma={1.02 + 0.04 * strength:.3f},gblur=sigma={0.18 + 0.28 * strength:.3f}'
    if effect == 'soft_glow':
        return f',eq=brightness={0.015 + 0.03 * strength:.3f}:saturation={1.02 + 0.10 * strength:.3f}:gamma={1.02 + 0.05 * strength:.3f}'
    if effect == 'vignette':
        return f',vignette=PI/{6.2 - 2.2 * strength:.3f}'
    if effect == 'film_grain':
        return f',eq=contrast={1.02 + 0.07 * strength:.3f}:saturation={0.98 - 0.14 * strength:.3f},noise=alls={2 + 7 * strength:.2f}:allf=t+u'
    if effect == 'warm_film':
        return f',colorbalance=rs={0.02 + 0.045 * strength:.3f}:gs={0.005 + 0.015 * strength:.3f}:bs={-0.015 - 0.035 * strength:.3f},eq=saturation={1.01 + 0.08 * strength:.3f}:contrast={1.01 + 0.04 * strength:.3f}'
    if effect == 'cool_night':
        return f',colorbalance=bs={0.025 + 0.055 * strength:.3f}:rs={-0.01 - 0.025 * strength:.3f},eq=saturation={0.98 - 0.10 * strength:.3f}:contrast={1.02 + 0.05 * strength:.3f}'
    if effect == 'vintage':
        return f',eq=saturation={0.92 - 0.22 * strength:.3f}:contrast={1.02 + 0.08 * strength:.3f}:brightness={0.008 + 0.018 * strength:.3f},noise=alls={1 + 3 * strength:.2f}:allf=t+u,vignette=PI/5.5'
    if effect == 'lofi':
        return f',eq=saturation={0.96 - 0.18 * strength:.3f}:contrast={1.01 + 0.05 * strength:.3f}:gamma={1.0 - 0.035 * strength:.3f},noise=alls={1 + 2.5 * strength:.2f}:allf=t+u'
    if effect == 'dramatic':
        return f',eq=contrast={1.08 + 0.16 * strength:.3f}:saturation={0.98 - 0.12 * strength:.3f}:brightness={-0.012 - 0.018 * strength:.3f},vignette=PI/4.5'
    if effect == 'monochrome':
        return f',hue=s=0,eq=contrast={1.05 + 0.12 * strength:.3f}'
    if effect == 'dynamic_mix':
        return f',eq=contrast={1.03 + 0.08 * strength:.3f}:saturation={1.0 + 0.08 * strength:.3f},vignette=PI/5.3,noise=alls={0.7 + 1.8 * strength:.2f}:allf=t+u'
    return ''


def build_visual_filter(width: int, height: int, fps: int, duration_sec: float, effect: str, intensity: float) -> str:
    motion_alias = {
        'cinematic': 'zoom_in', 'dreamy': 'zoom_in', 'soft_glow': 'drift',
        'warm_film': 'ken_burns', 'cool_night': 'drift', 'vintage': 'zoom_in',
        'lofi': 'drift', 'dramatic': 'zoom_in', 'dynamic_mix': 'drift',
    }
    motion_effects = {'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'pan_up', 'pan_down', 'drift', 'pulse', 'ken_burns'}
    motion = motion_alias.get(effect, effect)
    vf = _motion_base(width, height, fps, duration_sec, motion, intensity) if motion in motion_effects else _static_base(width, height)
    return vf + _color_suffix(effect, intensity) + ',format=yuv420p'


def build_video_filter(width: int, height: int, fps: int, effect: str, intensity: float) -> str:
    # Source video keeps its natural motion. We apply framing + color treatment only.
    return _static_base(width, height) + f',fps={fps}' + _color_suffix(effect, intensity) + ',format=yuv420p'


def _escape_filter_path(path: str) -> str:
    return str(Path(path).resolve()).replace('\\', '\\\\').replace("'", "\\'").replace(':', '\\:')


def _resolve_segment_durations(media_files: list[dict], total_duration: float) -> list[float]:
    n = len(media_files)
    if n == 0:
        return []
    total = max(0.5, float(total_duration or 0.5))
    requested = [max(0.0, float(item.get('duration_sec', 0) or 0)) for item in media_files]
    auto_ids = [i for i, value in enumerate(requested) if value <= 0]
    fixed_sum = sum(value for value in requested if value > 0)

    if auto_ids and fixed_sum < total - 0.1:
        each = max(0.35, (total - fixed_sum) / len(auto_ids))
        result = [value if value > 0 else each for value in requested]
    else:
        weights = [value if value > 0 else 1.0 for value in requested]
        weight_sum = max(0.001, sum(weights))
        result = [max(0.25, total * weight / weight_sum) for weight in weights]

    scale = total / max(0.001, sum(result))
    result = [max(0.20, value * scale) for value in result]
    # Correct rounding drift on the last segment.
    drift = total - sum(result)
    result[-1] = max(0.20, result[-1] + drift)
    return result


def render_media_timeline(
    media_files: list[dict],
    audio: str,
    output: str,
    width: int = 1080,
    height: int = 1920,
    fps: int = 30,
    duration_sec: float | None = None,
    audio_start_sec: float = 0,
    visual_effect_mode: str = 'auto',
    visual_effect_preset: str = 'auto',
    visual_effect_intensity: float = 0.65,
    effect_seed: str = 'ngs',
    subtitle_path: str | None = None,
) -> str:
    if not media_files:
        raise ValueError('At least one visual media item is required')
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    total_duration = max(0.5, float(duration_sec or 30.0))
    resolved_effect = resolve_visual_effect(visual_effect_mode, visual_effect_preset, effect_seed)
    segment_durations = _resolve_segment_durations(media_files, total_duration)

    cmd = ['ffmpeg', '-y']
    filter_parts: list[str] = []
    labels: list[str] = []

    for index, (item, seg_duration) in enumerate(zip(media_files, segment_durations)):
        path = str(item['path'])
        media_type = str(item.get('type', 'image')).lower()
        start_sec = max(0.0, float(item.get('start_sec', 0) or 0))
        if media_type == 'video':
            cmd += ['-stream_loop', '-1']
            if start_sec > 0:
                cmd += ['-ss', f'{start_sec:.3f}']
            cmd += ['-t', f'{seg_duration:.3f}', '-i', path]
            vf = build_video_filter(width, height, fps, resolved_effect, float(visual_effect_intensity or 0.65))
        else:
            cmd += ['-loop', '1', '-framerate', str(fps), '-t', f'{seg_duration:.3f}', '-i', path]
            vf = build_visual_filter(width, height, fps, seg_duration, resolved_effect, float(visual_effect_intensity or 0.65))
        label = f'v{index}'
        labels.append(f'[{label}]')
        filter_parts.append(f'[{index}:v]{vf},trim=duration={seg_duration:.3f},setpts=PTS-STARTPTS[{label}]')

    audio_index = len(media_files)
    if audio_start_sec > 0:
        cmd += ['-ss', f'{audio_start_sec:.3f}']
    cmd += ['-i', audio]

    filter_parts.append(''.join(labels) + f'concat=n={len(media_files)}:v=1:a=0[vbase]')
    final_label = 'vbase'
    if subtitle_path:
        filter_parts.append(f"[vbase]subtitles=filename='{_escape_filter_path(subtitle_path)}'[vsub]")
        final_label = 'vsub'

    cmd += [
        '-filter_complex', ';'.join(filter_parts),
        '-map', f'[{final_label}]',
        '-map', f'{audio_index}:a:0',
        '-r', str(fps),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
        '-c:a', 'aac', '-b:a', '192k',
        '-t', f'{total_duration:.3f}', '-shortest', '-movflags', '+faststart',
        output,
    ]
    subprocess.run(cmd, check=True)
    return resolved_effect


def render_still(
    image: str,
    audio: str,
    output: str,
    width: int = 1080,
    height: int = 1920,
    fps: int = 30,
    duration_sec: float | None = None,
    audio_start_sec: float = 0,
    visual_effect_mode: str = 'auto',
    visual_effect_preset: str = 'auto',
    visual_effect_intensity: float = 0.65,
    effect_seed: str = 'ngs',
    subtitle_path: str | None = None,
) -> str:
    return render_media_timeline(
        [{'path': image, 'type': 'image', 'duration_sec': duration_sec or 0}],
        audio, output, width, height, fps, duration_sec, audio_start_sec,
        visual_effect_mode, visual_effect_preset, visual_effect_intensity,
        effect_seed, subtitle_path,
    )
