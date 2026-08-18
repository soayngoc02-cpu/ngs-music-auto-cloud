const { ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { client, bucket } = require('./_r2');

async function readJson(key) {
  const result = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const text = await result.Body.transformToString();
  return JSON.parse(text);
}

async function signObject(key, disposition = 'inline') {
  if (!key) return '';
  const filename = String(key).split('/').pop() || 'file';
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ResponseCacheControl: 'no-store, max-age=0',
    ResponseContentDisposition: `${disposition}; filename="${filename.replace(/"/g, '')}"`,
  });
  return getSignedUrl(client(), command, { expiresIn: 3600 });
}

async function listJson(prefix, maxKeys = 100) {
  const result = await client().send(new ListObjectsV2Command({
    Bucket: bucket(), Prefix: prefix, MaxKeys: maxKeys,
  }));
  return (result.Contents || [])
    .filter((obj) => obj.Key && obj.Key.endsWith('.json'))
    .sort((a, b) => new Date(b.LastModified || 0) - new Date(a.LastModified || 0));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const requestedLimit = Number(req.query.limit || 36);
    const limit = Math.max(1, Math.min(60, Number.isFinite(requestedLimit) ? requestedLimit : 36));

    const [historyObjects, legacyObjects] = await Promise.all([
      listJson('jobs/history/', 200),
      listJson('jobs/done/', 200),
    ]);

    const source = [...historyObjects, ...legacyObjects];
    const seenOutputs = new Set();
    const items = [];

    for (const obj of source) {
      if (items.length >= limit) break;
      try {
        const job = await readJson(obj.Key);
        const outputKey = String(job.output_key || '');
        if (!outputKey || seenOutputs.has(outputKey)) continue;
        seenOutputs.add(outputKey);

        const [viewUrl, downloadUrl, imageUrl] = await Promise.all([
          signObject(outputKey, 'inline'),
          signObject(outputKey, 'attachment'),
          job.image_key ? signObject(job.image_key, 'inline') : Promise.resolve(''),
        ]);

        items.push({
          job_id: job.job_id || '',
          render_id: job.render_id || job.job_id || '',
          record_key: obj.Key,
          completed_at: job.completed_at || job.created_at || obj.LastModified || null,
          created_at: job.created_at || null,
          aspect_ratio: job.aspect_ratio || '',
          quality: job.quality || '',
          width: job.resolved_width || job.requested_width || 0,
          height: job.resolved_height || job.requested_height || 0,
          fps: job.resolved_fps || job.fps || 0,
          duration_sec: Number(job.resolved_duration_sec ?? job.duration_sec ?? 0),
          audio_start_sec: Number(job.resolved_audio_start_sec ?? job.audio_start_sec ?? 0),
          music_mode: job.music_mode || '',
          audio_key: job.selected_audio_key || job.audio_key || '',
          image_key: job.image_key || '',
          visual_effect: job.resolved_visual_effect || job.visual_effect?.preset || 'none',
          visual_effect_mode: job.visual_effect?.mode || '',
          subtitle_enabled: Boolean(job.subtitle?.enabled || job.subtitle_events > 0),
          subtitle_style: job.subtitle?.style || '',
          subtitle_animation: job.subtitle?.animation || '',
          subtitle_events: Number(job.subtitle_events || 0),
          output_key: outputKey,
          view_url: viewUrl,
          download_url: downloadUrl,
          image_url: imageUrl,
        });
      } catch (err) {
        console.warn('Skip completed record', obj.Key, err.message);
      }
    }

    return res.status(200).json({ items, count: items.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
