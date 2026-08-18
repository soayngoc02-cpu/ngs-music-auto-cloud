import math
import re
from pathlib import Path


STYLE_PRESETS = {
    'clean_pro': {
        'primary': '&H00FFFFFF', 'outline': '&H00101010', 'back': '&H50000000',
        'outline_w': 3, 'shadow': 1, 'border': 1, 'bold': -1, 'scale': 1.00,
    },
    'tiktok_pop': {
        'primary': '&H00FFFFFF', 'outline': '&H00000000', 'back': '&H64000000',
        'outline_w': 6, 'shadow': 1, 'border': 1, 'bold': -1, 'scale': 1.08,
    },
    'neon_glow': {
        'primary': '&H00FFFFFF', 'outline': '&H00D936FF', 'back': '&H50000000',
        'outline_w': 5, 'shadow': 2, 'border': 1, 'bold': -1, 'scale': 1.02,
    },
    'cinema': {
        'primary': '&H00F5F5F5', 'outline': '&H00101010', 'back': '&H50000000',
        'outline_w': 2, 'shadow': 2, 'border': 1, 'bold': -1, 'scale': 0.92,
    },
    'glass_box': {
        'primary': '&H00FFFFFF', 'outline': '&H00000000', 'back': '&H78000000',
        'outline_w': 1, 'shadow': 0, 'border': 3, 'bold': -1, 'scale': 0.98,
    },
    'gold': {
        'primary': '&H0000D7FF', 'outline': '&H00181818', 'back': '&H50000000',
        'outline_w': 4, 'shadow': 2, 'border': 1, 'bold': -1, 'scale': 1.02,
    },
    'heavy_outline': {
        'primary': '&H00FFFFFF', 'outline': '&H00000000', 'back': '&H50000000',
        'outline_w': 8, 'shadow': 0, 'border': 1, 'bold': -1, 'scale': 1.04,
    },
    'minimal': {
        'primary': '&H00FFFFFF', 'outline': '&H00151515', 'back': '&H32000000',
        'outline_w': 1, 'shadow': 1, 'border': 1, 'bold': 0, 'scale': 0.88,
    },
}


def _clean_lines(text: str) -> list[str]:
    out: list[str] = []
    for raw in (text or '').replace('\r', '').split('\n'):
        line = raw.strip()
        if not line:
            continue
        if re.fullmatch(r'\[[^\]]+\]', line):
            continue
        line = re.sub(r'^\s*\d{1,2}:\d{2}(?:\.\d+)?\s*[-–—:]?\s*', '', line).strip()
        if line:
            out.append(line)
    return out


def _segment_lines(
    lines: list[str],
    audio_total_sec: float,
    audio_start_sec: float,
    clip_duration_sec: float,
    proportional: bool,
) -> list[str]:
    if not lines:
        return []
    if not proportional or audio_total_sec <= 0 or clip_duration_sec <= 0:
        return lines

    start_ratio = max(0.0, min(1.0, audio_start_sec / audio_total_sec))
    end_ratio = max(start_ratio, min(1.0, (audio_start_sec + clip_duration_sec) / audio_total_sec))
    start_i = min(len(lines) - 1, int(math.floor(start_ratio * len(lines))))
    end_i = max(start_i + 1, int(math.ceil(end_ratio * len(lines))))
    end_i = min(len(lines), end_i)
    return lines[start_i:end_i] or [lines[start_i]]


def _group_for_readability(lines: list[str], clip_duration_sec: float, max_lines: int = 2) -> list[str]:
    if not lines:
        return []
    duration = max(1.0, clip_duration_sec)
    max_events = max(1, int(duration / 1.65))
    min_group = max(1, math.ceil(len(lines) / max_events))
    group_size = max(1, min(max_lines, min_group))

    groups: list[str] = []
    i = 0
    while i < len(lines):
        chunk = lines[i:i + group_size]
        groups.append('\\N'.join(chunk))
        i += group_size

    if len(groups) > max_events:
        target = max_events
        regrouped: list[str] = []
        per = math.ceil(len(lines) / target)
        for i in range(0, len(lines), per):
            regrouped.append('\\N'.join(lines[i:i + per]))
        groups = regrouped
    return groups


def _ass_time(seconds: float) -> str:
    value = max(0.0, float(seconds))
    h = int(value // 3600)
    m = int((value % 3600) // 60)
    s = value % 60
    return f'{h}:{m:02d}:{s:05.2f}'


def _escape_ass(text: str) -> str:
    value = str(text).replace('{', '（').replace('}', '）')
    value = value.replace('\\N', '__NGS_LINE_BREAK__')
    value = value.replace('\\', '＼')
    return value.replace('__NGS_LINE_BREAK__', '\\N')


def _animation_tag(animation: str, width: int, height: int, position: str) -> str:
    anim = (animation or 'fade').lower()
    if anim == 'pop':
        return r'{\fscx82\fscy82\t(0,180,\fscx100\fscy100)\fad(70,130)}'
    if anim == 'pulse':
        return r'{\fscx100\fscy100\t(0,260,\fscx106\fscy106)\t(260,620,\fscx100\fscy100)\fad(80,120)}'
    if anim == 'slide_up':
        y = int(height * ({'top': 0.18, 'center': 0.52, 'bottom': 0.83}.get(position, 0.83)))
        return rf'{{\an5\move({width // 2},{y + int(height * 0.025)},{width // 2},{y},0,260)\fad(70,120)}}'
    if anim == 'none':
        return ''
    return r'{\fad(150,170)}'


def generate_ass(
    lyrics_text: str,
    output_path: str,
    width: int,
    height: int,
    clip_duration_sec: float,
    audio_total_sec: float = 0,
    audio_start_sec: float = 0,
    lyrics_source: str = 'auto',
    style_name: str = 'clean_pro',
    animation: str = 'fade',
    position: str = 'bottom',
    size: str = 'large',
    max_lines: int = 2,
) -> int:
    lines = _clean_lines(lyrics_text)
    proportional = lyrics_source in {'auto', 'metadata'}
    lines = _segment_lines(lines, audio_total_sec, audio_start_sec, clip_duration_sec, proportional)
    groups = _group_for_readability(lines, clip_duration_sec, max_lines=max(1, int(max_lines or 2)))
    if not groups:
        return 0

    style = STYLE_PRESETS.get(style_name, STYLE_PRESETS['clean_pro'])
    size_factor = {'medium': 0.88, 'large': 1.0, 'xlarge': 1.18}.get(size, 1.0)
    font_size = max(28, int(height * 0.038 * style['scale'] * size_factor))
    alignment = {'top': 8, 'center': 5, 'bottom': 2}.get(position, 2)
    margin_v = int(height * ({'top': 0.075, 'center': 0.04, 'bottom': 0.075}.get(position, 0.075)))
    margin_h = max(24, int(width * 0.06))

    header = f'''[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,{font_size},{style['primary']},{style['primary']},{style['outline']},{style['back']},{style['bold']},0,0,0,100,100,0,0,{style['border']},{style['outline_w']},{style['shadow']},{alignment},{margin_h},{margin_h},{margin_v},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'''

    duration = max(0.5, float(clip_duration_sec or 0.5))
    slot = duration / len(groups)
    events: list[str] = []
    for index, text in enumerate(groups):
        start = index * slot + min(0.08, slot * 0.08)
        end = min(duration, (index + 1) * slot - min(0.08, slot * 0.06))
        if end <= start:
            end = min(duration, start + max(0.35, slot * 0.9))
        tag = _animation_tag(animation, width, height, position)
        events.append(
            f'Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Default,,0,0,0,,{tag}{_escape_ass(text)}'
        )

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(header + '\n'.join(events) + '\n', encoding='utf-8-sig')
    return len(events)
