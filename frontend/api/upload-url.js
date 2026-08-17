const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { client, bucket, safeName, prefixFor, allowedFile } = require('./_r2');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { kind, filename, content_type: contentType } = req.body || {};
    const cleanKind = String(kind || '').toLowerCase();
    const cleanName = safeName(filename);
    if (!allowedFile(cleanKind, cleanName)) {
      return res.status(400).json({ error: `Unsupported ${cleanKind || 'file'} type` });
    }

    const key = prefixFor(cleanKind) + cleanName;
    const command = new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType || 'application/octet-stream',
    });
    const url = await getSignedUrl(client(), command, { expiresIn: 900 });
    return res.status(200).json({
      ok: true,
      key,
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
      expires_in: 900,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
