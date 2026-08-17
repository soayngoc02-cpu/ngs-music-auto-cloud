import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.r2 import bucket, client

ORIGIN = 'https://ngs-music-studio.vercel.app'


def main() -> int:
    cors = {
        'CORSRules': [
            {
                'AllowedOrigins': [ORIGIN],
                'AllowedMethods': ['GET', 'PUT', 'HEAD'],
                'AllowedHeaders': ['Content-Type'],
                'ExposeHeaders': ['ETag', 'Content-Length'],
                'MaxAgeSeconds': 3600,
            }
        ]
    }
    client().put_bucket_cors(Bucket=bucket(), CORSConfiguration=cors)
    result = client().get_bucket_cors(Bucket=bucket())
    print('R2 CORS configured for:', ORIGIN)
    print(result.get('CORSRules', []))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
