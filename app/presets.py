import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PRESETS = ROOT / 'config' / 'render_presets.json'


@lru_cache(maxsize=1)
def load_presets(path: str | None = None) -> dict:
    preset_path = Path(path) if path else DEFAULT_PRESETS
    return json.loads(preset_path.read_text(encoding='utf-8'))


def resolve_preset(aspect_ratio: str, quality: str, path: str | None = None) -> tuple[int, int]:
    aspect = aspect_ratio.strip().lower()
    q = quality.strip().lower()
    presets = load_presets(path)
    if aspect not in presets:
        raise ValueError(f'Unsupported aspect ratio: {aspect_ratio}')
    if q not in presets[aspect]:
        raise ValueError(f'Unsupported quality {quality} for aspect ratio {aspect_ratio}')
    width, height = presets[aspect][q]
    return int(width), int(height)
