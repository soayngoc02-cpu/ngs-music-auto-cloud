import os
import shutil
import subprocess
import sys


def main() -> int:
    print('NGS Music Auto Cloud healthcheck')
    print('Python:', sys.version.split()[0])

    ffmpeg = shutil.which('ffmpeg')
    ffprobe = shutil.which('ffprobe')
    print('FFmpeg:', ffmpeg or 'MISSING')
    print('FFprobe:', ffprobe or 'MISSING')
    if not ffmpeg or not ffprobe:
        return 1

    subprocess.run(['ffmpeg', '-version'], check=True, stdout=subprocess.DEVNULL)

    required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
    missing = [x for x in required if not os.getenv(x)]
    if missing:
        print('R2 secrets not configured yet:', ', '.join(missing))
        print('Local/cloud runner dependencies OK; R2 connectivity skipped.')
        return 0

    from app.r2 import client, bucket
    s3 = client()
    s3.head_bucket(Bucket=bucket())
    print('R2 connectivity: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
