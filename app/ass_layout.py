import re
import textwrap
from pathlib import Path


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _scaled_font_size(width: int, height: int, logical_size: float) -> int:
    # Font size is expressed on a 1080px short-side reference so the same
    # numeric value looks consistent across 9:16, 1:1, 16:9 and 2K/4K.
    scale = max(0.25, min(width, height) / 1080.0)
    return max(18, int(round(float(logical_size) * scale)))


def _inject_layout_tag(text: str, width: int, height: int, y_percent: float) -> str:
    x = width // 2
    y = int(round(height * _clamp(float(y_percent), 5.0, 95.0) / 100.0))

    # Slide-up animation already uses \move(...); rewrite it to the exact live-preview Y.
    if '\\move(' in text:
        delta = max(8, int(height * 0.025))
        replacement = rf'\move({x},{y + delta},{x},{y},0,260)'
        text = re.sub(
            r'\\move\([^)]*\)',
            lambda _match: replacement,
            text,
            count=1,
        )
        if '\\an5' not in text:
            text = text.replace('{', '{\\an5', 1) if text.startswith('{') else '{\\an5}' + text
        return text

    position_tag = rf'\an5\pos({x},{y})'
    if text.startswith('{'):
        close = text.find('}')
        if close >= 0:
            first = text[1:close]
            first = re.sub(r'\\an\d', '', first)
            first = re.sub(r'\\pos\([^)]*\)', '', first)
            return '{' + position_tag + first + '}' + text[close + 1:]
    return '{' + position_tag + '}' + text


def _hard_wrap_dialogue(text: str, max_chars: int) -> str:
    # Preserve all leading ASS override blocks, then wrap only visible text.
    tags: list[str] = []
    rest = text
    while rest.startswith('{'):
        close = rest.find('}')
        if close < 0:
            break
        tags.append(rest[:close + 1])
        rest = rest[close + 1:]

    explicit_lines = rest.split('\\N')
    wrapped: list[str] = []
    for visible in explicit_lines:
        visible = visible.strip()
        if not visible:
            continue
        parts = textwrap.wrap(
            visible,
            width=max_chars,
            break_long_words=False,
            break_on_hyphens=False,
            replace_whitespace=False,
        )
        wrapped.extend(parts or [visible])
    return ''.join(tags) + '\\N'.join(wrapped)


def apply_ass_layout(
    ass_path: str,
    width: int,
    height: int,
    font_size: float = 68,
    y_percent: float = 78,
    safe_width_percent: float = 84,
) -> dict:
    """Make generated ASS match the web live preview and stay inside safe width.

    - Enables smart word wrapping (WrapStyle 0).
    - Applies a numeric logical font size.
    - Constrains text to a horizontal safe width using ASS margins.
    - Hard-wraps long lyric lines as an additional safety layer.
    - Places every subtitle block at the same Y% shown in the web preview.
    """
    path = Path(ass_path)
    text = path.read_text(encoding='utf-8-sig')

    safe_width = _clamp(float(safe_width_percent), 55.0, 94.0)
    y = _clamp(float(y_percent), 5.0, 95.0)
    logical_font = _clamp(float(font_size), 24.0, 140.0)
    resolved_font = _scaled_font_size(width, height, logical_font)
    safe_pixels = width * safe_width / 100.0
    margin_h = max(18, int(round(width * (1.0 - safe_width / 100.0) / 2.0)))
    # Average Vietnamese/Latin glyph is roughly 0.54 em; this is intentionally conservative.
    max_chars = max(12, min(48, int(safe_pixels / max(1.0, resolved_font * 0.54))))

    if re.search(r'^WrapStyle:\s*\d+\s*$', text, flags=re.MULTILINE):
        text = re.sub(r'^WrapStyle:\s*\d+\s*$', 'WrapStyle: 0', text, flags=re.MULTILINE)
    else:
        text = text.replace('[Script Info]\n', '[Script Info]\nWrapStyle: 0\n', 1)

    lines = text.splitlines()
    out: list[str] = []
    for line in lines:
        if line.startswith('Style: Default,'):
            prefix, body = line.split(': ', 1)
            fields = body.split(',')
            if len(fields) >= 23:
                fields[2] = str(resolved_font)
                fields[18] = '5'  # center anchor; exact Y comes from \pos/\move
                fields[19] = str(margin_h)
                fields[20] = str(margin_h)
                fields[21] = '0'
                line = prefix + ': ' + ','.join(fields)
        elif line.startswith('Dialogue: '):
            prefix, body = line.split(': ', 1)
            fields = body.split(',', 9)
            if len(fields) == 10:
                laid_out = _inject_layout_tag(fields[9], width, height, y)
                fields[9] = _hard_wrap_dialogue(laid_out, max_chars)
                line = prefix + ': ' + ','.join(fields)
        out.append(line)

    path.write_text('\n'.join(out) + '\n', encoding='utf-8-sig')
    return {
        'logical_font_size': round(logical_font, 2),
        'resolved_font_size': resolved_font,
        'y_percent': round(y, 2),
        'safe_width_percent': round(safe_width, 2),
        'margin_h': margin_h,
        'max_chars_per_line': max_chars,
        'wrap_style': 0,
    }
