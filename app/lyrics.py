import json
import subprocess
from pathlib import Path

LYRIC_TAGS = (
    'lyrics',
    'lyrics-eng',
    'unsyncedlyrics',
    'unsynced_lyrics',
    'lyric',
)


def extract_embedded_lyrics(audio_path: str) -> str:
    cmd = [
        'ffprobe', '-v', 'error',
        '-show_entries', 'format_tags',
        '-of', 'json',
        audio_path,
    ]
    data = json.loads(subprocess.check_output(cmd, text=True))
    tags = data.get('format', {}).get('tags', {}) or {}
    lowered = {str(k).lower(): str(v) for k, v in tags.items()}
    for key in LYRIC_TAGS:
        value = lowered.get(key, '').strip()
        if value:
            return value
    return ''


def load_lyrics(audio_path: str, lyrics_path: str | None = None, pasted_text: str | None = None) -> tuple[str, str]:
    if pasted_text and pasted_text.strip():
        return pasted_text.strip(), 'pasted'
    if lyrics_path:
        p = Path(lyrics_path)
        if p.exists():
            text = p.read_text(encoding='utf-8-sig').strip()
            if text:
                return text, 'file'
    embedded = extract_embedded_lyrics(audio_path).strip()
    if embedded:
        return embedded, 'metadata'
    return '', 'none'
