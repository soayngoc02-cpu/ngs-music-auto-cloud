const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { client, bucket, safeName, required } = require('./_r2');

const PRESETS = {
  '9:16': { '1080': [1080, 1920], '2k': [1440, 2560], '4k': [2160, 3840] },
  '1:1': { '1080': [1080, 1080], '2k': [1440, 1440], '4k': [2160, 2160] },
  '16:9': { '1080': [1920, 1080], '2k': [2560, 1440], '4k': [3840, 2160] },
};

const VISUAL_EFFECTS = new Set([
  'none', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'pan_up', 'pan_down',
  'drift', 'pulse', 'ken_burns', 'cinematic', 'dreamy', 'soft_glow', 'vignette',
  'film_grain', 'warm_film', 'cool_night', 'vintage', 'lofi', 'dramatic',
  'monochrome', 'dynamic_mix',
]);
const SUBTITLE_STYLES = new Set([
  'clean_pro', 'tiktok_pop', 'neon_glow', 'cinema', 'glass_box', 'gold', 'heavy_outline', 'minimal',
]);
const SUBTITLE_ANIMATIONS = new Set(['fade', 'pop', 'slide_up', 'pulse', 'none']);
const SUBTITLE_POSITIONS = new Set(['top', 'center', 'bottom']);
const SUBTITLE_SIZES = new Set(['medium', 'large', 'xlarge']);
const SUBTITLE_SYNC_MODES = new Set(['smart', 'timed', 'basic']);
const SUBTITLE_MODELS = new Set(['base', 'small']);

async function triggerWorkflow(jobKey) {
  const token = required('GITHUB_ACTIONS_TOKEN');
  const owner = process.env.GITHUB_OWNER || 'soayngoc02-cpu';
  const repo = process.env.GITHUB_REPO || 'ngs-music-auto-cloud';
  const ref = process.env.GITHUB_REF || 'main';
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/render-job.yml/dispatches`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ngs-music-studio-vercel',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref, inputs: { job_key: jobKey } }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub dispatch failed: ${response.status} ${text}`);
  }
}

async function removeOldStatus(jobId) {
  await Promise.allSettled([
    client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: `jobs/done/${jobId}.json` })),
    client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: `jobs/failed/${jobId}.json` })),
  ]);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    const jobId = safeName(body.job_id || '').replace(/\.[^.]+$/, '');
    if (!jobId) return res.status(400).json({ error: 'job_id is required' });
    if (!body.image_key) return res.status(400).json({ error: 'image_key is required' });

    const aspect = String(body.aspect_ratio || '9:16');
    const quality = String(body.quality || '1080').toLowerCase();
    if (!PRESETS[aspect] || !PRESETS[aspect][quality]) {
      return res.status(400).json({ error: 'Invalid aspect_ratio or quality' });
    }
    const [width, height] = PRESETS[aspect][quality];

    const musicMode = String(body.music_mode || (body.audio_key ? 'file' : 'auto')).toLowerCase();
    if (!['auto', 'file', 'manual'].includes(musicMode)) {
      return res.status(400).json({ error: 'Invalid music_mode' });
    }
    const audioStartSec = Number(body.audio_start_sec || 0);
    const durationSec = Number(body.duration_sec || 0);
    if (!Number.isFinite(audioStartSec) || audioStartSec < 0) {
      return res.status(400).json({ error: 'Invalid audio_start_sec' });
    }
    if (!Number.isFinite(durationSec) || durationSec < 0) {
      return res.status(400).json({ error: 'Invalid duration_sec' });
    }
    if (musicMode === 'manual' && durationSec <= 0) {
      return res.status(400).json({ error: 'Manual trim requires duration_sec > 0' });
    }

    const now = new Date();
    const renderStamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + String(now.getMilliseconds()).padStart(3, '0');
    const renderId = `${jobId}-${renderStamp}`;
    const lyrics = body.lyrics || {};
    const outputKey = String(body.output_key || `output/${jobId}/${renderId}.mp4`);

    const visual = body.visual_effect || {};
    let effectMode = String(visual.mode || 'auto').toLowerCase();
    if (!['auto', 'manual'].includes(effectMode)) effectMode = 'auto';
    let effectPreset = String(visual.preset || 'auto').toLowerCase();
    if (effectMode === 'manual' && !VISUAL_EFFECTS.has(effectPreset)) {
      return res.status(400).json({ error: `Invalid visual effect: ${effectPreset}` });
    }
    let effectIntensity = Number(visual.intensity ?? 0.65);
    if (!Number.isFinite(effectIntensity)) effectIntensity = 0.65;
    effectIntensity = Math.max(0.05, Math.min(1, effectIntensity));

    const subtitleInput = body.subtitle || {};
    const subtitleEnabled = Boolean(subtitleInput.enabled ?? lyrics.render ?? false);
    let subtitleStyle = String(subtitleInput.style || 'clean_pro').toLowerCase();
    if (!SUBTITLE_STYLES.has(subtitleStyle)) subtitleStyle = 'clean_pro';
    let subtitleAnimation = String(subtitleInput.animation || 'fade').toLowerCase();
    if (!SUBTITLE_ANIMATIONS.has(subtitleAnimation)) subtitleAnimation = 'fade';
    let subtitlePosition = String(subtitleInput.position || 'bottom').toLowerCase();
    if (!SUBTITLE_POSITIONS.has(subtitlePosition)) subtitlePosition = 'bottom';
    let subtitleSize = String(subtitleInput.size || 'large').toLowerCase();
    if (!SUBTITLE_SIZES.has(subtitleSize)) subtitleSize = 'large';
    const subtitleMaxLines = Math.max(1, Math.min(3, Number(subtitleInput.max_lines || 2)));
    let subtitleSyncMode = String(subtitleInput.sync_mode || 'smart').toLowerCase();
    if (!SUBTITLE_SYNC_MODES.has(subtitleSyncMode)) subtitleSyncMode = 'smart';
    let subtitleModel = String(subtitleInput.model || 'small').toLowerCase();
    if (!SUBTITLE_MODELS.has(subtitleModel)) subtitleModel = 'small';
    const subtitleLanguage = String(subtitleInput.language || 'vi').toLowerCase() || 'vi';
    let subtitleMinConfidence = Number(subtitleInput.min_confidence ?? 0.38);
    if (!Number.isFinite(subtitleMinConfidence)) subtitleMinConfidence = 0.38;
    subtitleMinConfidence = Math.max(0.15, Math.min(0.90, subtitleMinConfidence));

    let subtitleFontSize = Number(subtitleInput.font_size ?? 68);
    if (!Number.isFinite(subtitleFontSize)) subtitleFontSize = 68;
    subtitleFontSize = Math.max(24, Math.min(140, subtitleFontSize));
    const defaultY = subtitlePosition === 'top' ? 20 : subtitlePosition === 'center' ? 50 : 78;
    let subtitleYPercent = Number(subtitleInput.y_percent ?? defaultY);
    if (!Number.isFinite(subtitleYPercent)) subtitleYPercent = defaultY;
    subtitleYPercent = Math.max(5, Math.min(95, subtitleYPercent));
    let subtitleSafeWidthPercent = Number(subtitleInput.safe_width_percent ?? 84);
    if (!Number.isFinite(subtitleSafeWidthPercent)) subtitleSafeWidthPercent = 84;
    subtitleSafeWidthPercent = Math.max(55, Math.min(94, subtitleSafeWidthPercent));

    const job = {
      job_id: jobId,
      render_id: renderId,
      image_key: String(body.image_key),
      audio_key: String(body.audio_key || ''),
      output_key: outputKey,
      music_mode: musicMode,
      audio_start_sec: audioStartSec,
      audio_end_sec: Number(body.audio_end_sec || 0),
      aspect_ratio: aspect,
      quality,
      fps: Number(body.fps || 30),
      duration_sec: durationSec,
      lyrics: {
        source: String(lyrics.source || 'auto'),
        key: String(lyrics.key || ''),
        text: String(lyrics.text || ''),
        use_for_analysis: lyrics.use_for_analysis !== false,
        render: subtitleEnabled,
      },
      visual_effect: {
        mode: effectMode,
        preset: effectPreset,
        intensity: effectIntensity,
      },
      subtitle: {
        enabled: subtitleEnabled,
        style: subtitleStyle,
        animation: subtitleAnimation,
        position: subtitlePosition,
        size: subtitleSize,
        max_lines: subtitleMaxLines,
        sync_mode: subtitleSyncMode,
        language: subtitleLanguage,
        model: subtitleModel,
        min_confidence: subtitleMinConfidence,
        font_size: subtitleFontSize,
        y_percent: subtitleYPercent,
        safe_width_percent: subtitleSafeWidthPercent,
      },
      requested_width: width,
      requested_height: height,
      status: 'pending',
      created_at: now.toISOString(),
    };

    await removeOldStatus(jobId);

    const jobKey = `jobs/pending/${jobId}.json`;
    await client().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: jobKey,
      Body: JSON.stringify(job, null, 2),
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'no-store',
    }));

    try {
      await triggerWorkflow(jobKey);
      return res.status(202).json({ ok: true, job_key: jobKey, render_id: renderId, job });
    } catch (err) {
      const failed = { ...job, status: 'dispatch_failed', error: err.message };
      await client().send(new PutObjectCommand({
        Bucket: bucket(),
        Key: `jobs/failed/${jobId}.json`,
        Body: JSON.stringify(failed, null, 2),
        ContentType: 'application/json; charset=utf-8',
        CacheControl: 'no-store',
      }));
      return res.status(502).json({ error: err.message, job_key: jobKey, render_id: renderId });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
