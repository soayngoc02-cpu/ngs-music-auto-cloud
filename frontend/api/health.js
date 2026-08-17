const { HeadBucketCommand } = require('@aws-sdk/client-s3');
const { client, bucket } = require('./_r2');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    await client().send(new HeadBucketCommand({ Bucket: bucket() }));
    const githubReady = Boolean(process.env.GITHUB_ACTIONS_TOKEN);
    return res.status(200).json({
      service: 'NGS Music Studio API',
      status: 'ok',
      r2: 'ok',
      github_actions: githubReady ? 'ready' : 'missing_token',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
};
