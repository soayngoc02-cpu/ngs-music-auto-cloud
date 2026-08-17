import json
import subprocess
from pathlib import Path


def probe_audio(path: str) -> dict:
    cmd = [
        'ffprobe','-v','error','-show_entries',
        'format=duration,bit_rate:stream=codec_name,sample_rate,channels',
        '-of','json',path
    ]
    data = json.loads(subprocess.check_output(cmd, text=True))
    fmt = data.get('format', {})
    streams = data.get('streams', [])
    audio = next((s for s in streams if s.get('codec_name')), {})
    return {
        'file': Path(path).name,
        'duration_sec': round(float(fmt.get('duration', 0) or 0), 3),
        'bit_rate': int(float(fmt.get('bit_rate', 0) or 0)),
        'codec': audio.get('codec_name'),
        'sample_rate': int(audio.get('sample_rate', 0) or 0),
        'channels': int(audio.get('channels', 0) or 0),
    }


def save_dna(path: str, out_json: str) -> dict:
    dna = probe_audio(path)
    Path(out_json).parent.mkdir(parents=True, exist_ok=True)
    Path(out_json).write_text(json.dumps(dna, ensure_ascii=False, indent=2), encoding='utf-8')
    return dna
