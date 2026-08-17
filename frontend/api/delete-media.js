const {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { client, bucket } = require('./_r2');

const PREFIXES = {
  music: 'music/original/',
  image: 'images/',
  lyrics: 'lyrics/original/',
};

async function readJson(key) {
  try {
    const result = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return JSON.parse(await result.Body.transformToString());
  } catch (err) {
    if (err && (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404)) return null;
    throw err;
  }
}

async function cleanupMusicDna(audioKey) {
  const listed = await client().send(new ListObjectsV2Command({
    Bucket: bucket(),
    Prefix: 'music/dna/',
    MaxKeys: 1000,
  }));
  const matches = [];
  for (const obj of listed.Contents || []) {
    if (!obj.Key || !obj.Key.endsWith('.json')) continue;
    try {
      const dna = await readJson(obj.Key);
      if (dna && String(dna.r2_key || '') === audioKey) matches.push({ Key: obj.Key });
    } catch (_) {
      // Ignore malformed DNA entries while deleting the requested media.
    }
  }
  if (matches.length) {
    await client().send(new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: matches, Quiet: true },
    }));
  }
  return matches.map((item) => item.Key);
}

async function deleteVideo(body) {
  const outputKey = String(body.output_key || '').trim();
  const recordKey = String(body.record_key || '').trim();
  const jobId = String(body.job_id || '').trim();
  if (!outputKey.startsWith('output/')) throw new Error('Invalid video output key');
  if (recordKey && !recordKey.startsWith('jobs/history/') && !recordKey.startsWith('jobs/done/')) {
    throw new Error('Invalid video record key');
  }

  const objects = [{ Key: outputKey }];
  if (recordKey) objects.push({ Key: recordKey });

  if (jobId) {
    const latestKey = `jobs/done/${jobId}.json`;
    const latest = await readJson(latestKey);
    if (latest && String(latest.output_key || '') === outputKey && latestKey !== recordKey) {
      objects.push({ Key: latestKey });
    }
  }

  await client().send(new DeleteObjectsCommand({
    Bucket: bucket(),
    Delete: { Objects: objects, Quiet: true },
  }));
  return objects.map((item) => item.Key);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    const kind = String(body.kind || '').toLowerCase();

    if (kind === 'video') {
      const deleted = await deleteVideo(body);
      return res.status(200).json({ ok: true, kind, deleted });
    }

    const prefix = PREFIXES[kind];
    const key = String(body.key || '').trim();
    if (!prefix || !key.startsWith(prefix)) {
      return res.status(400).json({ error: 'Invalid media kind or key' });
    }

    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    const deleted = [key];
    if (kind === 'music') {
      deleted.push(...await cleanupMusicDna(key));
    }
    return res.status(200).json({ ok: true, kind, deleted });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
