export class NgsRenderApi {
  constructor(baseUrl) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, options);
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      const message = body && typeof body === 'object' ? body.error : String(body || response.statusText);
      throw new Error(message || `HTTP ${response.status}`);
    }
    return body;
  }

  getPresets() {
    return this.request('/api/render/presets');
  }

  listLibrary(kind) {
    const q = new URLSearchParams({ kind });
    return this.request(`/api/render/library?${q.toString()}`);
  }

  upload(kind, file) {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    return this.request('/api/render/upload', {
      method: 'POST',
      body: form,
    });
  }

  createJob(payload) {
    return this.request('/api/render/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  getJob(jobId) {
    return this.request(`/api/render/jobs/${encodeURIComponent(jobId)}`);
  }

  outputUrl(jobId) {
    return `${this.baseUrl}/api/render/output/${encodeURIComponent(jobId)}`;
  }

  async waitForJob(jobId, { intervalMs = 5000, timeoutMs = 60 * 60 * 1000, onUpdate } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const status = await this.getJob(jobId);
        if (onUpdate) onUpdate(status);
        if (status.status === 'done') return status;
        if (status.status === 'failed') {
          throw new Error(status.job?.error || 'Render failed');
        }
      } catch (err) {
        if (!String(err.message || '').includes('Job not found')) throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('Render timed out');
  }
}

export function buildRenderJob({
  jobId,
  imageKey,
  audioKey = '',
  aspectRatio = '9:16',
  quality = '1080',
  fps = 30,
  durationSec = 0,
  lyricsSource = 'auto',
  lyricsKey = '',
  lyricsText = '',
  useLyricsForAnalysis = true,
  renderLyrics = false,
}) {
  return {
    job_id: jobId,
    image_key: imageKey,
    audio_key: audioKey,
    output_key: `output/${jobId}.mp4`,
    aspect_ratio: aspectRatio,
    quality,
    fps,
    duration_sec: durationSec,
    lyrics: {
      source: lyricsSource,
      key: lyricsKey,
      text: lyricsText,
      use_for_analysis: useLyricsForAnalysis,
      render: renderLyrics,
    },
  };
}
