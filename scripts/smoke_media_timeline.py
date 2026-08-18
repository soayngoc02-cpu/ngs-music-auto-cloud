import json
import subprocess
import tempfile
from pathlib import Path

from app.render import render_media_timeline
from app.smart_subtitles import TimedLine
from app.smart_subtitles_v2 import _repair_local_gaps


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    lines = [f'Dòng lời số {i}' for i in range(1, 7)]
    direct = {
        0: TimedLine(lines[0], 0.2, 1.0, 0.9),
        4: TimedLine(lines[4], 4.6, 5.3, 0.9),
        5: TimedLine(lines[5], 5.4, 5.9, 0.9),
    }
    words = [
        {'start': 1.15, 'end': 1.55, 'probability': 0.8},
        {'start': 1.65, 'end': 2.05, 'probability': 0.8},
        {'start': 2.20, 'end': 2.55, 'probability': 0.8},
        {'start': 2.75, 'end': 3.15, 'probability': 0.8},
        {'start': 3.35, 'end': 3.75, 'probability': 0.8},
        {'start': 3.90, 'end': 4.35, 'probability': 0.8},
    ]
    repaired, diag = _repair_local_gaps(lines, direct, words, 6.0)
    assert all(i in repaired for i in (1, 2, 3)), (repaired, diag)
    print('SUB GAP REPAIR OK:', diag)

    with tempfile.TemporaryDirectory(prefix='ngs-media-smoke-') as tmp:
        root = Path(tmp)
        img1 = root / 'a.png'; img2 = root / 'b.png'; src_video = root / 'src.mp4'; audio = root / 'audio.wav'; ass = root / 'sub.ass'; out = root / 'out.mp4'
        run(['ffmpeg','-y','-f','lavfi','-i','color=c=red:s=720x1280:d=1','-frames:v','1',str(img1)])
        run(['ffmpeg','-y','-f','lavfi','-i','color=c=blue:s=720x1280:d=1','-frames:v','1',str(img2)])
        run(['ffmpeg','-y','-f','lavfi','-i','testsrc2=s=720x1280:r=30:d=2','-an','-c:v','libx264','-pix_fmt','yuv420p',str(src_video)])
        run(['ffmpeg','-y','-f','lavfi','-i','sine=frequency=440:duration=6','-c:a','pcm_s16le',str(audio)])
        ass.write_text('''[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H50000000,-1,0,0,0,100,100,0,0,1,3,1,2,50,50,80,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.30,0:00:05.70,Default,,0,0,0,,Timeline smoke subtitle\n''', encoding='utf-8')
        render_media_timeline([
            {'path': str(img1), 'type': 'image', 'duration_sec': 2},
            {'path': str(src_video), 'type': 'video', 'duration_sec': 2, 'start_sec': 0},
            {'path': str(img2), 'type': 'image', 'duration_sec': 2},
        ], str(audio), str(out), width=720, height=1280, fps=30, duration_sec=6, visual_effect_mode='manual', visual_effect_preset='cinematic', subtitle_path=str(ass))
        probe = subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(out)], text=True)
        duration = float(json.loads(probe)['format']['duration'])
        assert 5.7 <= duration <= 6.3, duration
        assert out.stat().st_size > 10000
        print('MEDIA TIMELINE OK:', round(duration, 3), out.stat().st_size)


if __name__ == '__main__':
    main()
