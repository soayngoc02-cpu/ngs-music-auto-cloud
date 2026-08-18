const { S3Client } = require('@aws-sdk/client-s3');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function client() {
  const accountId = required('R2_ACCOUNT_ID');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
  });
}

function bucket() { return required('R2_BUCKET'); }

function safeName(name) {
  return String(name || 'file')
    .normalize('NFKC')
    .replace(/[\\/]+/g, '_')
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .trim()
    .slice(0, 180) || 'file';
}

function prefixFor(kind) {
  if (kind === 'music') return 'music/original/';
  if (kind === 'image') return 'images/';
  if (kind === 'video') return 'video/original/';
  if (kind === 'lyrics') return 'lyrics/original/';
  throw new Error('kind must be music, image, video, or lyrics');
}

function allowedFile(kind, filename) {
  const name = filename.toLowerCase();
  const sets = {
    music: ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'],
    image: ['.jpg', '.jpeg', '.png', '.webp'],
    video: ['.mp4', '.mov', '.m4v', '.webm', '.mkv'],
    lyrics: ['.txt'],
  };
  return Boolean(sets[kind] && sets[kind].some((ext) => name.endsWith(ext)));
}

module.exports = { client, bucket, required, safeName, prefixFor, allowedFile };
