const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { client, bucket, safeName } = require('./_r2');

async function readDone(id) {
  const result = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: `jobs/done/${id}.json` }));
  const text = await result.Body.transformToString();
  return JSON.parse(text);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const id = safeName(req.query.id || '').replace(/\.[^.]+$/, '');
    if (!id) return res.status(400).json({ error: 'id is required' });
    let done;
    try {
      done = await readDone(id);
    } catch (err) {
      if (err && (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404)) {
        return res.status(404).json({ error: 'Completed job not found' });
      }
      throw err;
    }
    const key = done.output_key || `output/${id}.mp4`;
    const url = await getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: 3600 });
    return res.status(200).json({ ok: true, key, url, expires_in: 3600 });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
