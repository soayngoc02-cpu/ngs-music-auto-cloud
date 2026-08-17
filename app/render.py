import subprocess
from pathlib import Path


def render_still(image: str, audio: str, output: str, width: int = 1080, height: int = 1920, fps: int = 30) -> None:
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    vf = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},format=yuv420p"
    cmd = [
        'ffmpeg','-y','-loop','1','-i',image,'-i',audio,
        '-vf',vf,'-r',str(fps),'-c:v','libx264','-preset','veryfast',
        '-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',output
    ]
    subprocess.run(cmd, check=True)
