import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.r2 import download


def main() -> int:
    if len(sys.argv) != 2:
        print('false')
        return 0
    with tempfile.TemporaryDirectory(prefix='ngs-features-') as tmp:
        local = Path(tmp) / 'job.json'
        download(sys.argv[1], str(local))
        data = json.loads(local.read_text(encoding='utf-8'))
    subtitle = data.get('subtitle') or {}
    lyrics = data.get('lyrics') or {}
    enabled = bool(subtitle.get('enabled', lyrics.get('render', False)))
    sync_mode = str(subtitle.get('sync_mode', 'smart')).strip().lower()
    print('true' if enabled and sync_mode == 'smart' else 'false')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
