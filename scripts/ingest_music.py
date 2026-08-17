import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.music_dna import probe_audio
from app.r2 import download, list_keys, upload

AUDIO_EXTENSIONS = {'.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus'}


def dna_key_for(audio_key: str) -> str:
    safe = audio_key.replace('/', '__').replace('\\', '__')
    return f"music/dna/{safe}.json"


def analyze_key(key: str) -> str:
    suffix = Path(key).suffix or '.audio'
    with tempfile.TemporaryDirectory(prefix='ngs-dna-') as tmp:
        local_audio = Path(tmp) / f"source{suffix}"
        local_json = Path(tmp) / 'dna.json'
        download(key, str(local_audio))
        dna = probe_audio(str(local_audio))
        dna['r2_key'] = key
        dna['dna_version'] = 1
        local_json.write_text(json.dumps(dna, ensure_ascii=False, indent=2), encoding='utf-8')
        out_key = dna_key_for(key)
        upload(str(local_json), out_key)
        print(f"DNA OK: {key} -> {out_key}")
        return out_key


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--key', help='One R2 audio key to analyze')
    parser.add_argument('--prefix', default='music/original/', help='R2 prefix when scanning all music')
    args = parser.parse_args()

    if args.key:
        keys = [args.key]
    else:
        keys = [k for k in list_keys(args.prefix) if Path(k).suffix.lower() in AUDIO_EXTENSIONS]

    if not keys:
        print('No audio files found to analyze.')
        return 0

    for key in keys:
        analyze_key(key)
    print(f"Music DNA complete: {len(keys)} file(s)")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
