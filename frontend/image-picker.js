const previousFetch = window.fetch.bind(window);
const API_BASE = () => (localStorage.getItem('ngs_api_base') || window.location.origin).replace(/\/+$/, '');
const $ = (id) => document.getElementById(id);
const PROXY_NAME = '__ngs_visual_timeline_proxy__.png';

const visualState = {
  items: [],
  cloudImages: [],
  cloudVideos: [],
  signedUrls: new Map(),
  selectedPreviewId: '',
  syncingProxy: false,
};

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function basename(key) { return String(key || '').split('/').pop() || '—'; }
function formatBytes(bytes) {
  const value = Number(bytes || 0);
  return value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(2)} MB`;
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
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function signedUrl(key) {
  const cached = visualState.signedUrls.get(key);
  if (cached && Date.now() - cached.createdAt < 45 * 60 * 1000) return cached.url;
  const result = await apiGet(`/api/media-url?key=${encodeURIComponent(key)}`);
  visualState.signedUrls.set(key, { url: result.url, createdAt: Date.now() });
  return result.url;
}

function transparentProxyFile() {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X7qkAAAAAElFTkSuQmCC';
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new File([bytes], PROXY_NAME, { type: 'image/png' });
}

function syncLegacyProxy() {
  const input = $('imageInput');
  if (!input) return;
  const transfer = new DataTransfer();
  if (visualState.items.length) transfer.items.add(transparentProxyFile());
  visualState.syncingProxy = true;
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  visualState.syncingProxy = false;
  updateDropSummary();
  updateMainPreview();
}

function updateDropSummary() {
  const count = visualState.items.length;
  if ($('imageName')) $('imageName').textContent = count ? `${count} asset trong timeline` : 'Chưa chọn hình / video';
  const status = $('visualUploadStatus');
  if (status && count) {
    const images = visualState.items.filter((item) => item.type === 'image').length;
    const videos = count - images;
    status.textContent = `✓ ${images} ảnh · ${videos} video · đã sẵn sàng trên Cloud`;
  }
}

function ensurePreviewVideo() {
  const frame = $('previewFrame');
  if (!frame) return null;
  let video = $('visualPreviewVideo');
  if (!video) {
    video = document.createElement('video');
    video.id = 'visualPreviewVideo';
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'metadata';
    frame.insertBefore(video, $('previewEmpty'));
  }
  return video;
}

async function updateMainPreview(item = null) {
  const frame = $('previewFrame');
  if (!frame) return;
  const current = item || visualState.items.find((x) => x.id === visualState.selectedPreviewId) || visualState.items[0];
  const img = $('previewImage');
  const video = ensurePreviewVideo();
  if (!current) {
    frame.classList.remove('has-image', 'has-visual');
    if (video) { video.pause(); video.removeAttribute('src'); }
    return;
  }
  visualState.selectedPreviewId = current.id;
  frame.classList.add('has-image', 'has-visual');
  let url = current.previewUrl;
  if (!url && current.key) {
    try { url = await signedUrl(current.key); current.previewUrl = url; } catch (_) {}
  }
  if (current.type === 'video') {
    if (img) img.style.display = 'none';
    if (video) {
      video.style.display = 'block';
      if (url && video.src !== url) video.src = url;
      video.play().catch(() => {});
    }
  } else {
    if (video) { video.pause(); video.style.display = 'none'; }
    if (img) {
      img.style.display = 'block';
      if (url) img.src = url;
    }
  }
  document.querySelectorAll('.visual-timeline-item').forEach((el) => el.classList.toggle('previewing', el.dataset.id === current.id));
}

async function uploadLocalFile(file) {
  const type = file.type.startsWith('video/') ? 'video' : 'image';
  const signed = await apiPost('/api/upload-url', {
    kind: type, filename: file.name, content_type: file.type || 'application/octet-stream',
  });
  const upload = await previousFetch(signed.url, {
    method: signed.method || 'PUT',
    headers: signed.headers || { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!upload.ok) throw new Error(`Upload ${file.name} lỗi: HTTP ${upload.status}`);
  return {
    id: uid(), key: signed.key, type, name: file.name, source: 'local',
    previewUrl: URL.createObjectURL(file), duration_sec: 0, start_sec: 0,
  };
}

async function addLocalFiles(files) {
  const list = [...files];
  if (!list.length) return;
  const status = $('visualUploadStatus');
  try {
    for (let i = 0; i < list.length; i += 1) {
      if (status) status.textContent = `Đang upload ${i + 1}/${list.length}: ${list[i].name}`;
      const item = await uploadLocalFile(list[i]);
      visualState.items.push(item);
      window.dispatchEvent(new CustomEvent('ngs:library-changed', { detail: { kind: item.type, key: item.key } }));
    }
    renderTimeline();
    syncLegacyProxy();
    toast(`Đã thêm ${list.length} asset vào timeline`);
  } catch (err) {
    if (status) status.textContent = err.message;
    toast(err.message);
  }
}

function addCloudItem(raw, type) {
  if (visualState.items.some((item) => item.key === raw.key)) return toast('Asset này đã có trong timeline');
  const item = {
    id: uid(), key: raw.key, type, name: basename(raw.key), source: 'cloud',
    previewUrl: '', duration_sec: 0, start_sec: 0,
  };
  visualState.items.push(item);
  renderTimeline();
  syncLegacyProxy();
  $('visualCloudPicker')?.classList.remove('show');
  toast(`Đã thêm ${type === 'video' ? 'video' : 'ảnh'} Cloud`);
}

function moveItem(id, delta) {
  const index = visualState.items.findIndex((item) => item.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= visualState.items.length) return;
  [visualState.items[index], visualState.items[target]] = [visualState.items[target], visualState.items[index]];
  renderTimeline();
}

function removeItem(id) {
  const index = visualState.items.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = visualState.items.splice(index, 1);
  if (removed?.source === 'local' && removed.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl);
  if (visualState.selectedPreviewId === id) visualState.selectedPreviewId = visualState.items[0]?.id || '';
  renderTimeline();
  syncLegacyProxy();
}

function renderTimeline() {
  const host = $('visualTimelineList');
  if (!host) return;
  if (!visualState.items.length) {
    host.innerHTML = '<div class="visual-empty">Chưa có asset. Thêm nhiều ảnh hoặc video từ máy / Cloud.</div>';
    updateDropSummary();
    return;
  }
  host.innerHTML = '';
  visualState.items.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'visual-timeline-item';
    card.dataset.id = item.id;
    card.innerHTML = `
      <button type="button" class="visual-thumb" title="Xem asset này"><span>${item.type === 'video' ? '▶ VIDEO' : '▧ ẢNH'}</span></button>
      <div class="visual-meta"><strong>${index + 1}. ${item.name}</strong><small>${item.source === 'cloud' ? 'Cloud' : 'Máy → Cloud'} · ${item.type === 'video' ? 'Video nguồn (mute)' : 'Ảnh'}</small></div>
      <label>Thời lượng<input class="visual-duration" type="number" min="0" step="0.1" value="${item.duration_sec || 0}" /><small>0 = Auto</small></label>
      ${item.type === 'video' ? `<label>Bắt đầu<input class="visual-start" type="number" min="0" step="0.1" value="${item.start_sec || 0}" /><small>giây</small></label>` : '<div></div>'}
      <div class="visual-actions"><button type="button" class="mini up" title="Lên">↑</button><button type="button" class="mini down" title="Xuống">↓</button><button type="button" class="mini remove" title="Bỏ khỏi timeline">✕</button></div>
    `;
    card.querySelector('.visual-thumb').addEventListener('click', () => updateMainPreview(item));
    card.querySelector('.up').addEventListener('click', () => moveItem(item.id, -1));
    card.querySelector('.down').addEventListener('click', () => moveItem(item.id, 1));
    card.querySelector('.remove').addEventListener('click', () => removeItem(item.id));
    card.querySelector('.visual-duration').addEventListener('change', (e) => { item.duration_sec = Math.max(0, Number(e.target.value || 0)); });
    card.querySelector('.visual-start')?.addEventListener('change', (e) => { item.start_sec = Math.max(0, Number(e.target.value || 0)); });
    host.append(card);
  });
  updateDropSummary();
  updateMainPreview();
}

async function renderCloudPicker() {
  const host = $('visualCloudGrid');
  if (!host) return;
  const query = String($('visualCloudSearch')?.value || '').trim().toLowerCase();
  const tab = document.querySelector('#visualCloudTabs button.active')?.dataset.type || 'all';
  const all = [
    ...visualState.cloudImages.map((item) => ({ ...item, mediaType: 'image' })),
    ...visualState.cloudVideos.map((item) => ({ ...item, mediaType: 'video' })),
  ].filter((item) => (tab === 'all' || item.mediaType === tab) && basename(item.key).toLowerCase().includes(query));
  if (!all.length) {
    host.innerHTML = '<div class="visual-empty">Không có asset phù hợp.</div>';
    return;
  }
  host.innerHTML = '';
  for (const item of all) {
    const card = document.createElement('article');
    card.className = 'visual-cloud-card';
    card.innerHTML = `
      <div class="visual-cloud-thumb"><span>${item.mediaType === 'video' ? '▶ VIDEO' : '▧ ẢNH'}</span></div>
      <div><strong>${basename(item.key)}</strong><small>${formatBytes(item.size)}</small></div>
      <button type="button" class="primary">+ Timeline</button>`;
    card.querySelector('button').addEventListener('click', () => addCloudItem(item, item.mediaType));
    card.querySelector('.visual-cloud-thumb').addEventListener('click', async () => {
      const temp = { id: uid(), key: item.key, type: item.mediaType, name: basename(item.key), previewUrl: '' };
      await updateMainPreview(temp);
    });
    host.append(card);
  }
}

async function refreshCloud() {
  const host = $('visualCloudGrid');
  if (host) host.innerHTML = '<div class="visual-empty">Đang tải Kho Cloud…</div>';
  try {
    const [images, videos] = await Promise.all([apiGet('/api/library?kind=image'), apiGet('/api/library?kind=video')]);
    visualState.cloudImages = images.objects || [];
    visualState.cloudVideos = videos.objects || [];
    renderCloudPicker();
  } catch (err) {
    if (host) host.innerHTML = `<div class="visual-empty">Lỗi tải kho: ${err.message}</div>`;
  }
}

function installVisualTimeline() {
  const drop = $('imageDrop');
  if (!drop || $('visualTimelinePanel')) return;
  drop.querySelector('.upload-label').textContent = 'Hình / Video';
  drop.querySelector('small').textContent = 'Nhiều ảnh · MP4/MOV/WEBM/MKV · tự lưu Cloud';
  const legacyButton = drop.querySelector('[data-pick="imageInput"]');
  if (legacyButton) legacyButton.hidden = true;

  const controls = document.createElement('div');
  controls.className = 'visual-source-buttons';
  controls.innerHTML = `<button type="button" class="secondary" id="addVisualLocal">+ Máy tính</button><button type="button" class="secondary" id="openVisualCloud">☁ Kho Cloud</button>`;
  drop.append(controls);
  const status = document.createElement('div');
  status.id = 'visualUploadStatus'; status.className = 'image-upload-status'; drop.append(status);

  const localInput = document.createElement('input');
  localInput.id = 'visualLocalInput'; localInput.type = 'file'; localInput.multiple = true;
  localInput.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.m4v,.mkv';
  localInput.hidden = true; document.body.append(localInput);

  const panel = document.createElement('section');
  panel.className = 'card visual-timeline-panel'; panel.id = 'visualTimelinePanel';
  panel.innerHTML = `
    <div class="card-head"><div><p class="eyebrow">VISUAL TIMELINE</p><h2>Nhiều ảnh + video nguồn</h2><p class="muted">0 giây = Auto chia theo tổng thời lượng. Video nguồn được mute để giữ nhạc đã chọn.</p></div><span class="pill" id="visualCountBadge">0 asset</span></div>
    <div id="visualTimelineList" class="visual-timeline-list"></div>
    <div id="visualCloudPicker" class="visual-cloud-picker">
      <div class="visual-cloud-toolbar"><label>Tìm asset<input id="visualCloudSearch" type="search" placeholder="Tên ảnh / video..." /></label><button type="button" class="ghost" id="refreshVisualCloud">↻ Làm mới</button><button type="button" class="ghost" id="closeVisualCloud">Đóng</button></div>
      <div class="segmented" id="visualCloudTabs"><button class="active" data-type="all">Tất cả</button><button data-type="image">Ảnh</button><button data-type="video">Video</button></div>
      <div id="visualCloudGrid" class="visual-cloud-grid"></div>
    </div>`;
  document.querySelector('#view-render > .grid.two')?.insertAdjacentElement('afterend', panel);

  $('addVisualLocal').addEventListener('click', () => localInput.click());
  $('openVisualCloud').addEventListener('click', () => { $('visualCloudPicker').classList.add('show'); refreshCloud(); });
  $('closeVisualCloud').addEventListener('click', () => $('visualCloudPicker').classList.remove('show'));
  $('refreshVisualCloud').addEventListener('click', refreshCloud);
  $('visualCloudSearch').addEventListener('input', renderCloudPicker);
  $('visualCloudTabs').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    $('visualCloudTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === button));
    renderCloudPicker();
  }));
  localInput.addEventListener('change', async (event) => {
    await addLocalFiles(event.target.files || []);
    localInput.value = '';
  });

  const observer = new MutationObserver(() => {
    if ($('visualCountBadge')) $('visualCountBadge').textContent = `${visualState.items.length} asset`;
  });
  observer.observe($('visualTimelineList'), { childList: true });
  renderTimeline();
}

function patchFetchForVisualTimeline() {
  window.fetch = async function patchedVisualFetch(input, init = {}) {
    const rawUrl = typeof input === 'string' ? input : input?.url || '';
    if (rawUrl === 'ngs-uploaded://visual') return new Response('', { status: 200 });
    let pathname = rawUrl;
    try { pathname = new URL(rawUrl, window.location.origin).pathname; } catch (_) {}
    const method = String(init?.method || 'GET').toUpperCase();

    if (pathname === '/api/upload-url' && method === 'POST') {
      try {
        const body = JSON.parse(init.body || '{}');
        if (body.kind === 'image' && body.filename === PROXY_NAME && visualState.items.length) {
          return new Response(JSON.stringify({ ok: true, key: visualState.items[0].key, url: 'ngs-uploaded://visual', method: 'PUT', headers: {} }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (_) {}
    }

    if (pathname === '/api/jobs' && method === 'POST' && visualState.items.length) {
      try {
        const payload = JSON.parse(init.body || '{}');
        payload.image_key = visualState.items[0].key;
        payload.media_items = visualState.items.map((item) => ({
          key: item.key, type: item.type,
          duration_sec: Math.max(0, Number(item.duration_sec || 0)),
          start_sec: Math.max(0, Number(item.start_sec || 0)),
        }));
        return previousFetch(input, { ...init, body: JSON.stringify(payload) });
      } catch (_) {}
    }
    return previousFetch(input, init);
  };
}

patchFetchForVisualTimeline();
installVisualTimeline();
setTimeout(refreshCloud, 700);
window.NGSVisualMedia = {
  getItems: () => visualState.items.map((item) => ({ key: item.key, type: item.type, duration_sec: item.duration_sec, start_sec: item.start_sec })),
  hasSelection: () => visualState.items.length > 0,
};
