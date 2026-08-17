const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { client, bucket } = require('./_r2');

const ALLOWED_PREFIXES = [
  'music/original/',
  'images/',
  'lyrics/original/',
  'output/',
];

function allowedKey(key) {
  return ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const key = String(req.query.key || '').trim();
    if (!key || !allowedKey(key)) return res.status(400).json({ error: 'Invalid media key' });

    const filename = key.split('/').pop() || 'media';
    const command = new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseCacheControl: 'no-store, max-age=0',
      ResponseContentDisposition: `inline; filename="${filename.replace(/"/g, '')}"`,
    });
    const url = await getSignedUrl(client(), command, { expiresIn: 3600 });
    return res.status(200).json({ ok: true, key, url, expires_in: 3600 });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
