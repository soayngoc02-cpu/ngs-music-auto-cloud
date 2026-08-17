const PRESETS = {
  '9:16': { '1080': [1080, 1920], '2k': [1440, 2560], '4k': [2160, 3840] },
  '1:1': { '1080': [1080, 1080], '2k': [1440, 1440], '4k': [2160, 2160] },
  '16:9': { '1080': [1920, 1080], '2k': [2560, 1440], '4k': [3840, 2160] },
};

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(env),
    },
  });
}

function safeName(name) {
  return String(name || 'file')
    .normalize('NFKC')
    .replace(/[\\/]+/g, '_')
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .trim()
    .slice(0, 180) || 'file';
}

function uploadPrefix(kind) {
  if (kind === 'music') return 'music/original/';
  if (kind === 'image') return 'images/';
  if (kind === 'lyrics') return 'lyrics/original/';
  throw new Error('kind must be music, image, or lyrics');
}

function extensionAllowed(kind, filename) {
  const name = filename.toLowerCase();
  const sets = {
    music: ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'],
    image: ['.jpg', '.jpeg', '.png', '.webp'],
    lyrics: ['.txt'],
  };
  return sets[kind].some((ext) => name.endsWith(ext));
}

async function putJson(bucket, key, data) {
  await bucket.put(key, JSON.stringify(data, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

async function readJson(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return JSON.parse(await obj.text());
}

async function triggerRender(env, jobKey) {
  if (!env.GITHUB_ACTIONS_TOKEN) {
    throw new Error('Worker secret GITHUB_ACTIONS_TOKEN is not configured');
  }
  const owner = env.GITHUB_OWNER || 'soayngoc02-cpu';
  const repo = env.GITHUB_REPO || 'ngs-music-auto-cloud';
  const ref = env.GITHUB_REF || 'main';
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/render-job.yml/dispatches`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'ngs-music-auto-api',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref,
      inputs: { job_key: jobKey },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub workflow dispatch failed: ${response.status} ${body}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function handleUpload(request, env) {
  const form = await request.formData();
  const kind = String(form.get('kind') || '').toLowerCase();
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return json({ error: 'file is required' }, 400, env);
  }
  let prefix;
  try {
    prefix = uploadPrefix(kind);
  } catch (err) {
    return json({ error: err.message }, 400, env);
  }
  const filename = safeName(file.name);
  if (!extensionAllowed(kind, filename)) {
    return json({ error: `Unsupported ${kind} file type` }, 400, env);
  }

  const key = prefix + filename;
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  return json({ ok: true, kind, key, filename }, 201, env);
}

async function handleCreateJob(request, env) {
  const body = await request.json();
  const jobId = safeName(body.job_id || '').replace(/\.[^.]+$/, '');
  if (!jobId) return json({ error: 'job_id is required' }, 400, env);
  if (!body.image_key) return json({ error: 'image_key is required' }, 400, env);

  const aspect = String(body.aspect_ratio || '9:16');
  const quality = String(body.quality || '1080').toLowerCase();
  if (!PRESETS[aspect] || !PRESETS[aspect][quality]) {
    return json({ error: 'Invalid aspect_ratio or quality' }, 400, env);
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
  await putJson(env.MEDIA, jobKey, job);

  try {
    const dispatch = await triggerRender(env, jobKey);
    return json({ ok: true, job_key: jobKey, job, dispatch }, 202, env);
  } catch (err) {
    const failed = { ...job, status: 'dispatch_failed', error: err.message };
    await putJson(env.MEDIA, `jobs/failed/${jobId}.json`, failed);
    return json({ error: err.message, job_key: jobKey }, 502, env);
  }
}

async function handleJobStatus(jobId, env) {
  const id = safeName(jobId).replace(/\.[^.]+$/, '');
  for (const [status, prefix] of [
    ['done', 'jobs/done/'],
    ['failed', 'jobs/failed/'],
    ['pending', 'jobs/pending/'],
  ]) {
    const key = `${prefix}${id}.json`;
    const data = await readJson(env.MEDIA, key);
    if (data) return json({ status, key, job: data }, 200, env);
  }
  return json({ error: 'Job not found', job_id: id }, 404, env);
}

async function handleOutput(jobId, env) {
  const id = safeName(jobId).replace(/\.[^.]+$/, '');
  const done = await readJson(env.MEDIA, `jobs/done/${id}.json`);
  if (!done) return json({ error: 'Completed job not found' }, 404, env);
  const key = done.output_key || `output/${id}.mp4`;
  const obj = await env.MEDIA.get(key);
  if (!obj) return json({ error: 'Output object not found', key }, 404, env);
  const headers = new Headers(corsHeaders(env));
  obj.writeHttpMetadata(headers);
  headers.set('Content-Type', headers.get('Content-Type') || 'video/mp4');
  headers.set('Content-Disposition', `inline; filename="${id}.mp4"`);
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
  return new Response(obj.body, { headers });
}

async function handleLibrary(kind, env) {
  let prefix;
  try {
    prefix = uploadPrefix(kind);
  } catch (err) {
    return json({ error: err.message }, 400, env);
  }
  const result = await env.MEDIA.list({ prefix, limit: 1000 });
  return json({
    kind,
    prefix,
    objects: result.objects.map((obj) => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded,
      etag: obj.etag,
    })),
    truncated: result.truncated,
  }, 200, env);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (request.method === 'GET' && path === '/api/render/presets') {
        return json({ presets: PRESETS }, 200, env);
      }
      if (request.method === 'POST' && path === '/api/render/upload') {
        return handleUpload(request, env);
      }
      if (request.method === 'POST' && path === '/api/render/jobs') {
        return handleCreateJob(request, env);
      }
      if (request.method === 'GET' && path.startsWith('/api/render/jobs/')) {
        return handleJobStatus(path.split('/').pop(), env);
      }
      if (request.method === 'GET' && path.startsWith('/api/render/output/')) {
        return handleOutput(path.split('/').pop(), env);
      }
      if (request.method === 'GET' && path === '/api/render/library') {
        return handleLibrary(String(url.searchParams.get('kind') || ''), env);
      }
      if (request.method === 'GET' && path === '/') {
        return json({ service: 'NGS Music Auto API', status: 'ok' }, 200, env);
      }
      return json({ error: 'Not found' }, 404, env);
    } catch (err) {
      return json({ error: err.message || String(err) }, 500, env);
    }
  },
};
