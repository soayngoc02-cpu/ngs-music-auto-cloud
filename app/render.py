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
        f'crop={width}:{height}'
    )


def _motion_base(width: int, height: int, fps: int, duration_sec: float, effect: str, intensity: float) -> str:
    frames = max(1, int(max(0.5, duration_sec) * max(1, fps)))
    strength = max(0.05, min(1.0, intensity))
    extra = 1.18
    sw = max(width + 2, int(width * extra))
    sh = max(height + 2, int(height * extra))
    preload = (
        f'scale={sw}:{sh}:force_original_aspect_ratio=increase,'
        f'crop={sw}:{sh}'
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


def build_visual_filter(
    width: int,
    height: int,
    fps: int,
    duration_sec: float,
    effect: str,
    intensity: float,
) -> str:
    motion_alias = {
        'cinematic': 'zoom_in',
        'dreamy': 'zoom_in',
        'soft_glow': 'drift',
        'warm_film': 'ken_burns',
        'cool_night': 'drift',
        'vintage': 'zoom_in',
        'lofi': 'drift',
        'dramatic': 'zoom_in',
        'dynamic_mix': 'drift',
    }
    motion_effects = {
        'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'pan_up', 'pan_down',
        'drift', 'pulse', 'ken_burns',
    }
    motion = motion_alias.get(effect, effect)
    if motion in motion_effects:
        vf = _motion_base(width, height, fps, duration_sec, motion, intensity)
    else:
        vf = _static_base(width, height)

    strength = max(0.05, min(1.0, intensity))
    if effect == 'cinematic':
        vf += f',eq=contrast={1.04 + 0.08 * strength:.3f}:saturation={1.01 + 0.08 * strength:.3f}:brightness={-0.008 * strength:.4f},vignette=PI/{6.0 - 1.5 * strength:.3f}'
    elif effect == 'dreamy':
        vf += f',eq=saturation={0.96 + 0.06 * strength:.3f}:brightness={0.015 + 0.025 * strength:.3f}:gamma={1.02 + 0.04 * strength:.3f},gblur=sigma={0.18 + 0.28 * strength:.3f}'
    elif effect == 'soft_glow':
        vf += f',eq=brightness={0.015 + 0.03 * strength:.3f}:saturation={1.02 + 0.10 * strength:.3f}:gamma={1.02 + 0.05 * strength:.3f}'
    elif effect == 'vignette':
        vf += f',vignette=PI/{6.2 - 2.2 * strength:.3f}'
    elif effect == 'film_grain':
        vf += f',eq=contrast={1.02 + 0.07 * strength:.3f}:saturation={0.98 - 0.14 * strength:.3f},noise=alls={2 + 7 * strength:.2f}:allf=t+u'
    elif effect == 'warm_film':
        vf += f',colorbalance=rs={0.02 + 0.045 * strength:.3f}:gs={0.005 + 0.015 * strength:.3f}:bs={-0.015 - 0.035 * strength:.3f},eq=saturation={1.01 + 0.08 * strength:.3f}:contrast={1.01 + 0.04 * strength:.3f}'
    elif effect == 'cool_night':
        vf += f',colorbalance=bs={0.025 + 0.055 * strength:.3f}:rs={-0.01 - 0.025 * strength:.3f},eq=saturation={0.98 - 0.10 * strength:.3f}:contrast={1.02 + 0.05 * strength:.3f}'
    elif effect == 'vintage':
        vf += f',eq=saturation={0.92 - 0.22 * strength:.3f}:contrast={1.02 + 0.08 * strength:.3f}:brightness={0.008 + 0.018 * strength:.3f},noise=alls={1 + 3 * strength:.2f}:allf=t+u,vignette=PI/5.5'
    elif effect == 'lofi':
        vf += f',eq=saturation={0.96 - 0.18 * strength:.3f}:contrast={1.01 + 0.05 * strength:.3f}:gamma={1.0 - 0.035 * strength:.3f},noise=alls={1 + 2.5 * strength:.2f}:allf=t+u'
    elif effect == 'dramatic':
        vf += f',eq=contrast={1.08 + 0.16 * strength:.3f}:saturation={0.98 - 0.12 * strength:.3f}:brightness={-0.012 - 0.018 * strength:.3f},vignette=PI/4.5'
    elif effect == 'monochrome':
        vf += f',hue=s=0,eq=contrast={1.05 + 0.12 * strength:.3f}'
    elif effect == 'dynamic_mix':
        vf += f',eq=contrast={1.03 + 0.08 * strength:.3f}:saturation={1.0 + 0.08 * strength:.3f},vignette=PI/5.3,noise=alls={0.7 + 1.8 * strength:.2f}:allf=t+u'

    return vf + ',format=yuv420p'


def _escape_filter_path(path: str) -> str:
    return str(Path(path).resolve()).replace('\\', '\\\\').replace("'", "\\'").replace(':', '\\:')


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
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    effective_duration = max(0.5, float(duration_sec or 30.0))
    resolved_effect = resolve_visual_effect(visual_effect_mode, visual_effect_preset, effect_seed)
    vf = build_visual_filter(
        width=width,
        height=height,
        fps=fps,
        duration_sec=effective_duration,
        effect=resolved_effect,
        intensity=float(visual_effect_intensity or 0.65),
    )
    if subtitle_path:
        vf += f",subtitles=filename='{_escape_filter_path(subtitle_path)}'"

    cmd = ['ffmpeg', '-y', '-loop', '1', '-framerate', str(fps), '-i', image]
    if audio_start_sec > 0:
        cmd += ['-ss', str(audio_start_sec)]
    cmd += [
        '-i', audio,
        '-vf', vf,
        '-r', str(fps),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-movflags', '+faststart',
    ]
    if duration_sec is not None and duration_sec > 0:
        cmd += ['-t', str(duration_sec)]
    cmd.append(output)
    subprocess.run(cmd, check=True)
    return resolved_effect
