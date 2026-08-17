const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { client, bucket, safeName, required } = require('./_r2');

const PRESETS = {
  '9:16': { '1080': [1080, 1920], '2k': [1440, 2560], '4k': [2160, 3840] },
  '1:1': { '1080': [1080, 1080], '2k': [1440, 1440], '4k': [2160, 2160] },
  '16:9': { '1080': [1920, 1080], '2k': [2560, 1440], '4k': [3840, 2160] },
};

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

module.exports = async function handler(req, res) {
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
    const lyrics = body.lyrics || {};
    const job = {
      job_id: jobId,
      image_key: String(body.image_key),
      audio_key: String(body.audio_key || ''),
      output_key: String(body.output_key || `output/${jobId}.mp4`),
      aspect_ratio: aspect,
      quality,
      fps: Number(body.fps || 30),
      duration_sec: Number(body.duration_sec || 0),
      lyrics: {
        source: String(lyrics.source || 'auto'),
        key: String(lyrics.key || ''),
        text: String(lyrics.text || ''),
        use_for_analysis: lyrics.use_for_analysis !== false,
        render: Boolean(lyrics.render),
      },
      requested_width: width,
      requested_height: height,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    const jobKey = `jobs/pending/${jobId}.json`;
    await client().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: jobKey,
      Body: JSON.stringify(job, null, 2),
      ContentType: 'application/json; charset=utf-8',
    }));

    try {
      await triggerWorkflow(jobKey);
      return res.status(202).json({ ok: true, job_key: jobKey, job });
    } catch (err) {
      const failed = { ...job, status: 'dispatch_failed', error: err.message };
      await client().send(new PutObjectCommand({
        Bucket: bucket(),
        Key: `jobs/failed/${jobId}.json`,
        Body: JSON.stringify(failed, null, 2),
        ContentType: 'application/json; charset=utf-8',
      }));
      return res.status(502).json({ error: err.message, job_key: jobKey });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
