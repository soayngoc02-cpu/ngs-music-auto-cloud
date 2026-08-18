const previousFetch = window.fetch.bind(window);
const API_BASE = () => (localStorage.getItem('ngs_api_base') || window.location.origin).replace(/\/+$/, '');
const $ = (id) => document.getElementById(id);

const imageState = {
  cloudKey: '',
  cloudName: '',
  cloudItems: [],
  cloudUrls: new Map(),
  localUploadedKey: '',
  localUploadedName: '',
  localUploadPromise: null,
  settingCloudFile: false,
};

function basename(key) {
  return String(key || '').split('/').pop() || '—';
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

async function apiGet(path) {
  const joiner = path.includes('?') ? '&' : '?';
  const res = await previousFetch(`${API_BASE()}${path}${joiner}_=${Date.now()}`, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function apiPost(path, payload) {
  const res = await previousFetch(`${API_BASE()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function signedImageUrl(key) {
  const cached = imageState.cloudUrls.get(key);
  if (cached && Date.now() - cached.createdAt < 45 * 60 * 1000) return cached.url;
  const result = await apiGet(`/api/media-url?key=${encodeURIComponent(key)}`);
  imageState.cloudUrls.set(key, { url: result.url, createdAt: Date.now() });
  return result.url;
}

function setSourceActive(source) {
  document.querySelectorAll('#imageSourceSwitch button').forEach((button) => {
    button.classList.toggle('active', button.dataset.source === source);
  });
}

function clearCloudImage() {
  imageState.cloudKey = '';
  imageState.cloudName = '';
  const drop = $('imageDrop');
  if (drop) {
    delete drop.dataset.cloudKey;
    delete drop.dataset.cloudName;
  }
  $('cloudImageSelected')?.classList.remove('show');
}

async function useCloudImage(item) {
  try {
    const url = await signedImageUrl(item.key);
    const response = await previousFetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const file = new File([blob], basename(item.key), { type: blob.type || 'image/jpeg' });

    const input = $('imageInput');
    if (!input) throw new Error('Không tìm thấy ô chọn hình');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    imageState.settingCloudFile = true;
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    imageState.settingCloudFile = false;

    imageState.localUploadedKey = '';
    imageState.localUploadedName = '';
    imageState.cloudKey = item.key;
    imageState.cloudName = basename(item.key);
    const drop = $('imageDrop');
    if (drop) {
      drop.dataset.cloudKey = item.key;
      drop.dataset.cloudName = imageState.cloudName;
    }
    if ($('cloudImageSelectedName')) $('cloudImageSelectedName').textContent = imageState.cloudName;
    $('cloudImageSelected')?.classList.add('show');
    setSourceActive('cloud');
    $('cloudImagePicker')?.classList.remove('show');
    if ($('imageUploadStatus')) $('imageUploadStatus').textContent = '✓ Đang dùng ảnh có sẵn trên Cloud';
    renderCloudImages();
    toast(`Đang dùng ảnh Cloud: ${imageState.cloudName}`);
  } catch (err) {
    imageState.settingCloudFile = false;
    toast(`Không dùng được ảnh Cloud: ${err.message}`);
  }
}

async function uploadLocalImage(file) {
  if (!file) return;
  const status = $('imageUploadStatus');
  try {
    if (status) status.textContent = 'Đang lưu ảnh lên Cloud…';
    const signed = await apiPost('/api/upload-url', {
      kind: 'image', filename: file.name, content_type: file.type || 'application/octet-stream',
    });
    const upload = await previousFetch(signed.url, {
      method: signed.method || 'PUT',
      headers: signed.headers || { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!upload.ok) throw new Error(`HTTP ${upload.status}`);
    imageState.localUploadedKey = signed.key;
    imageState.localUploadedName = file.name;
    const drop = $('imageDrop');
    if (drop) {
      drop.dataset.localUploadedKey = signed.key;
      drop.dataset.localUploadedName = file.name;
    }
    if (status) status.textContent = '✓ Đã lưu ảnh vào Kho Cloud';
    window.dispatchEvent(new CustomEvent('ngs:library-changed', { detail: { kind: 'image', key: signed.key } }));
  } catch (err) {
    imageState.localUploadedKey = '';
    if (status) status.textContent = `Upload ảnh lỗi: ${err.message}`;
  }
}

async function hydrateThumbnail(item, img) {
  try {
    img.src = await signedImageUrl(item.key);
  } catch (_) {
    img.removeAttribute('src');
  }
}

function renderCloudImages() {
  const host = $('cloudImageGrid');
  if (!host) return;
  const query = String($('cloudImageSearch')?.value || '').trim().toLowerCase();
  const items = imageState.cloudItems.filter((item) => basename(item.key).toLowerCase().includes(query));
  if (!items.length) {
    host.innerHTML = '<div class="cloud-image-empty">Không có ảnh phù hợp.</div>';
    return;
  }
  host.innerHTML = '';
  for (const item of items) {
    const card = document.createElement('article');
    card.className = `cloud-image-card${item.key === imageState.cloudKey ? ' selected' : ''}`;
    card.innerHTML = `
      <div class="cloud-image-thumb"><img alt="${basename(item.key).replace(/"/g, '&quot;')}" loading="lazy" /></div>
      <div class="cloud-image-info"><strong title="${item.key.replace(/"/g, '&quot;')}">${basename(item.key)}</strong><small>${formatBytes(item.size)}</small></div>
      <button class="primary cloud-image-use" type="button">Dùng ảnh này</button>
    `;
    card.querySelector('.cloud-image-use').addEventListener('click', () => useCloudImage(item));
    host.append(card);
    hydrateThumbnail(item, card.querySelector('img'));
  }
}

async function refreshCloudImages() {
  const host = $('cloudImageGrid');
  if (host) host.innerHTML = '<div class="cloud-image-empty">Đang tải Kho ảnh…</div>';
  try {
    const result = await apiGet('/api/library?kind=image');
    imageState.cloudItems = (result.objects || []).sort((a, b) => new Date(b.uploaded || 0) - new Date(a.uploaded || 0));
    if (imageState.cloudKey && !imageState.cloudItems.some((item) => item.key === imageState.cloudKey)) clearCloudImage();
    renderCloudImages();
  } catch (err) {
    if (host) host.innerHTML = `<div class="cloud-image-empty">Lỗi tải kho ảnh: ${err.message}</div>`;
  }
}

function installImagePicker() {
  const drop = $('imageDrop');
  if (!drop || $('imageSourceSwitch')) return;
  const localButton = drop.querySelector('[data-pick="imageInput"]');
  if (localButton) localButton.textContent = 'Chọn ảnh trên máy';

  const sourceSwitch = document.createElement('div');
  sourceSwitch.id = 'imageSourceSwitch';
  sourceSwitch.className = 'image-source-switch';
  sourceSwitch.innerHTML = `<button type="button" data-source="cloud">Kho Cloud</button><button type="button" class="active" data-source="local">Máy tính</button>`;
  drop.insertBefore(sourceSwitch, localButton || drop.lastChild);

  const status = document.createElement('div');
  status.id = 'imageUploadStatus';
  status.className = 'image-upload-status';
  drop.append(status);

  const selected = document.createElement('div');
  selected.id = 'cloudImageSelected';
  selected.className = 'cloud-image-selected';
  selected.innerHTML = `<strong id="cloudImageSelectedName">Chưa chọn ảnh Cloud</strong><button class="image-mini-btn" id="cloudImageChange" type="button">Đổi ảnh</button>`;
  drop.append(selected);

  const picker = document.createElement('section');
  picker.id = 'cloudImagePicker';
  picker.className = 'card cloud-image-picker';
  picker.innerHTML = `
    <div class="card-head"><div><p class="eyebrow">CLOUD IMAGES</p><h2>Chọn ảnh có sẵn trên Cloud</h2></div><button class="ghost small" id="closeCloudImagePicker" type="button">Đóng</button></div>
    <div class="cloud-image-toolbar"><label>Tìm ảnh<input id="cloudImageSearch" type="search" placeholder="Nhập tên ảnh..." /></label><button class="ghost" id="refreshCloudImages" type="button">↻ Làm mới</button></div>
    <div class="cloud-image-grid" id="cloudImageGrid"></div>
  `;
  document.querySelector('#view-render > .grid.two')?.insertAdjacentElement('afterend', picker);

  sourceSwitch.querySelector('[data-source="cloud"]').addEventListener('click', () => { setSourceActive('cloud'); picker.classList.add('show'); refreshCloudImages(); });
  sourceSwitch.querySelector('[data-source="local"]').addEventListener('click', () => { clearCloudImage(); setSourceActive('local'); picker.classList.remove('show'); localButton?.click(); });
  $('closeCloudImagePicker').addEventListener('click', () => picker.classList.remove('show'));
  $('refreshCloudImages').addEventListener('click', refreshCloudImages);
  $('cloudImageSearch').addEventListener('input', renderCloudImages);
  $('cloudImageChange').addEventListener('click', () => { picker.classList.add('show'); refreshCloudImages(); });

  $('imageInput')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0] || null;
    if (!file || imageState.settingCloudFile) return;
    clearCloudImage();
    setSourceActive('local');
    imageState.localUploadPromise = uploadLocalImage(file);
  });

  window.addEventListener('ngs:library-changed', (event) => {
    if (event.detail?.kind === 'image') {
      imageState.cloudUrls.delete(event.detail.key);
      if (event.detail.key && event.detail.key === imageState.cloudKey) clearCloudImage();
      if (picker.classList.contains('show')) refreshCloudImages();
    }
  });
}

function patchFetchForImageSelection() {
  window.fetch = async function patchedImageFetch(input, init = {}) {
    const rawUrl = typeof input === 'string' ? input : input?.url || '';
    if (rawUrl === 'ngs-uploaded://image') return new Response('', { status: 200 });
    let pathname = rawUrl;
    try { pathname = new URL(rawUrl, window.location.origin).pathname; } catch (_) {}
    const method = String(init?.method || 'GET').toUpperCase();

    if (pathname === '/api/upload-url' && method === 'POST') {
      try {
        const body = JSON.parse(init.body || '{}');
        if (body.kind === 'image') {
          if (imageState.cloudKey && body.filename === imageState.cloudName) {
            return new Response(JSON.stringify({ ok: true, key: imageState.cloudKey, url: 'ngs-uploaded://image', method: 'PUT', headers: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (imageState.localUploadedKey && body.filename === imageState.localUploadedName) {
            return new Response(JSON.stringify({ ok: true, key: imageState.localUploadedKey, url: 'ngs-uploaded://image', method: 'PUT', headers: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }
      } catch (_) {}
    }

    if (pathname === '/api/jobs' && method === 'POST' && imageState.cloudKey) {
      try {
        const payload = JSON.parse(init.body || '{}');
        payload.image_key = imageState.cloudKey;
        return previousFetch(input, { ...init, body: JSON.stringify(payload) });
      } catch (_) {}
    }
    return previousFetch(input, init);
  };
}

patchFetchForImageSelection();
installImagePicker();
setTimeout(refreshCloudImages, 650);
