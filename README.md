# NGS Music Auto Cloud

Cloud-first automation pipeline for NGS Music.

## Architecture

`Cloudflare R2 -> GitHub Actions -> Music DNA -> Music Selector -> FFmpeg -> Cloudflare R2`

The home PC is not used for rendering.

## Components

- `app/r2.py`: Cloudflare R2 S3-compatible client helpers.
- `app/music_dna.py`: deterministic, low-cost audio metadata/DNA extraction using FFprobe/FFmpeg.
- `app/music_selector.py`: rule-based music selection without paid AI APIs.
- `app/render.py`: FFmpeg render entry point.
- `scripts/healthcheck.py`: verifies Python, FFmpeg, config, and optional R2 connectivity.
- `.github/workflows/test-cloud.yml`: cloud runner smoke test.
- `.github/workflows/render.yml`: manual render pipeline skeleton.

## Required GitHub Actions secrets

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

## R2 layout

```text
music/original/
music/dna/
images/
jobs/pending/
jobs/processing/
jobs/done/
output/
```

## Status

Phase 1: cloud skeleton and runner healthcheck.
