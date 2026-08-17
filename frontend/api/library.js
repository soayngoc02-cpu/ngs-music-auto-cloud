const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { client, bucket, prefixFor } = require('./_r2');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const kind = String(req.query.kind || '').toLowerCase();
    let prefix;
    try {
      prefix = prefixFor(kind);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const result = await client().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, MaxKeys: 1000 }));
    const objects = (result.Contents || [])
      .map((obj) => ({
        key: obj.Key,
        size: obj.Size || 0,
        uploaded: obj.LastModified || null,
        etag: obj.ETag || '',
      }))
      .sort((a, b) => new Date(b.uploaded || 0) - new Date(a.uploaded || 0));
    return res.status(200).json({ kind, prefix, objects, truncated: Boolean(result.IsTruncated) });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
