import hashlib
import unicodedata


GROUPS = {
    'sad': ['cinematic', 'dreamy', 'cool_night', 'lofi', 'zoom_in'],
    'romance': ['warm_film', 'soft_glow', 'dreamy', 'ken_burns', 'cinematic'],
    'nostalgia': ['vintage', 'film_grain', 'warm_film', 'ken_burns', 'zoom_out'],
    'upbeat': ['dynamic_mix', 'pulse', 'drift', 'pan_right', 'zoom_in'],
    'calm': ['drift', 'soft_glow', 'dreamy', 'pan_left', 'ken_burns'],
    'default': ['cinematic', 'ken_burns', 'drift', 'zoom_in', 'soft_glow', 'warm_film'],
}

KEYWORDS = {
    'sad': ['buon', 'nho', 'chia tay', 'co don', 'nuoc mat', 'dau', 'mat nhau', 'xa nhau', 'dem', 'mua'],
    'romance': ['yeu', 'thuong', 'tinh yeu', 'ben em', 'ben anh', 'trai tim', 'mai mai', 'duyen'],
    'nostalgia': ['ngay xua', 'ky niem', 'thanh xuan', 'nam thang', 'hoai niem', 'ngay ay', 'loi cu'],
    'upbeat': ['dance', 'remix', 'nonstop', 'vinahouse', 'quay', 'party', 'nhay', 'bung chay', 'soi dong'],
    'calm': ['chill', 'binh yen', 'nhe nhang', 'giac mo', 'may', 'gio', 'hoang hon'],
}


def _fold(text: str) -> str:
    value = unicodedata.normalize('NFD', str(text or '').lower())
    return ''.join(ch for ch in value if unicodedata.category(ch) != 'Mn')


def choose_auto_effect(seed: str, lyrics_text: str = '', duration_sec: float = 0) -> str:
    text = _fold(lyrics_text)
    scores = {name: sum(1 for keyword in words if keyword in text) for name, words in KEYWORDS.items()}
    best = max(scores, key=scores.get) if scores else 'default'
    if not scores or scores.get(best, 0) == 0:
        best = 'upbeat' if 0 < duration_sec <= 18 else 'default'

    pool = GROUPS.get(best, GROUPS['default'])
    digest = hashlib.sha256(f'{seed}|{best}|{round(float(duration_sec or 0), 1)}'.encode('utf-8')).digest()
    return pool[int.from_bytes(digest[:4], 'big') % len(pool)]
