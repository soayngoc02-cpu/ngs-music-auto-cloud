const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { client, bucket, safeName } = require('./_r2');

async function readJson(key) {
  try {
    const result = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const text = await result.Body.transformToString();
    return JSON.parse(text);
  } catch (err) {
    if (err && (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404)) return null;
    throw err;
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const id = safeName(req.query.id || '').replace(/\.[^.]+$/, '');
    if (!id) return res.status(400).json({ error: 'id is required' });

    for (const [status, prefix] of [
      ['done', 'jobs/done/'],
      ['failed', 'jobs/failed/'],
      ['pending', 'jobs/pending/'],
    ]) {
      const key = `${prefix}${id}.json`;
      const job = await readJson(key);
      if (job) return res.status(200).json({ status, key, job });
    }
    return res.status(404).json({ error: 'Job not found', job_id: id });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
