import json
from pathlib import Path


def score(dna: dict, target: dict) -> float:
    s = 0.0
    duration = float(dna.get('duration_sec', 0) or 0)
    min_d = float(target.get('min_duration_sec', 0) or 0)
    max_d = float(target.get('max_duration_sec', 10**9) or 10**9)
    if min_d <= duration <= max_d:
        s += 2.0
    if dna.get('channels') == target.get('preferred_channels', dna.get('channels')):
        s += 0.5
    return s


def choose(dna_files: list[str], rules_path: str) -> dict:
    rules = json.loads(Path(rules_path).read_text(encoding='utf-8'))
    candidates = []
    for p in dna_files:
        dna = json.loads(Path(p).read_text(encoding='utf-8'))
        candidates.append((score(dna, rules), dna))
    if not candidates:
        raise RuntimeError('No music candidates')
    candidates.sort(key=lambda x: (-x[0], x[1].get('file', '')))
    return candidates[0][1]
