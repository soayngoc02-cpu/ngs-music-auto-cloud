import hashlib
import os
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.r2 import bucket, client


def main() -> int:
    s3 = client()
    b = bucket()
    key = f"jobs/_healthcheck/roundtrip-{uuid.uuid4().hex}.txt"
    payload = f"NGS Music Auto Cloud R2 roundtrip\n{time.time_ns()}\n{uuid.uuid4().hex}\n".encode("utf-8")
    expected = hashlib.sha256(payload).hexdigest()

    try:
        s3.put_object(Bucket=b, Key=key, Body=payload, ContentType="text/plain; charset=utf-8")
        response = s3.get_object(Bucket=b, Key=key)
        downloaded = response["Body"].read()
        actual = hashlib.sha256(downloaded).hexdigest()
        if actual != expected:
            raise RuntimeError(f"Checksum mismatch: expected={expected} actual={actual}")
        print("R2 write: OK")
        print("R2 read: OK")
        print("R2 checksum: OK", actual)
        return 0
    finally:
        try:
            s3.delete_object(Bucket=b, Key=key)
            print("R2 cleanup: OK")
        except Exception as exc:
            print("R2 cleanup warning:", exc)


if __name__ == "__main__":
    raise SystemExit(main())
