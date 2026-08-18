const API_BASE = () => (localStorage.getItem('ngs_api_base') || window.location.origin).replace(/\/+$/, '');

const mediaCache = {
  loadedAt: 0,
  byName: new Map(),
  signed: new Map(),
};

function basename(key) {
  return String(key || '').split('/').pop() || '';
}

async function apiGet(path) {
  const joiner = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API_BASE()}${path}${joiner}_=${Date.now()}`, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function refreshMediaIndex(force = false) {
  if (!force && mediaCache.byName.size && Date.now() - mediaCache.loadedAt < 15000) return;
  const [images, videos] = await Promise.all([
    apiGet('/api/library?kind=image'),
    apiGet('/api/library?kind=video'),
  ]);
  mediaCache.byName.clear();
  for (const item of images.objects || []) {
    mediaCache.byName.set(`image:${basename(item.key)}`, { key: item.key, type: 'image' });
  }
  for (const item of videos.objects || []) {
    mediaCache.byName.set(`video:${basename(item.key)}`, { key: item.key, type: 'video' });
  }
  mediaCache.loadedAt = Date.now();
}

async function signedUrl(key) {
  const cached = mediaCache.signed.get(key);
  if (cached && Date.now() - cached.createdAt < 45 * 60 * 1000) return cached.url;
  const result = await apiGet(`/api/media-url?key=${encodeURIComponent(key)}`);
  mediaCache.signed.set(key, { url: result.url, createdAt: Date.now() });
  return result.url;
}

function mediaTypeForCard(card) {
  const label = card.querySelector('.visual-cloud-thumb span')?.textContent || '';
  return /video/i.test(label) ? 'video' : 'image';
}

async function hydrateCloudCard(card) {
  if (!card || card.dataset.thumbState === 'loading' || card.dataset.thumbState === 'ready') return;
  const name = card.querySelector('strong')?.textContent?.trim();
  const thumb = card.querySelector('.visual-cloud-thumb');
  if (!name || !thumb) return;

  card.dataset.thumbState = 'loading';
  try {
    await refreshMediaIndex();
    const type = mediaTypeForCard(card);
    let item = mediaCache.byName.get(`${type}:${name}`);
    if (!item) {
      await refreshMediaIndex(true);
      item = mediaCache.byName.get(`${type}:${name}`);
    }
    if (!item) throw new Error('Không tìm thấy media key');

    const url = await signedUrl(item.key);
    thumb.innerHTML = '';
    thumb.classList.add('has-real-thumb');

    if (type === 'video') {
      const video = document.createElement('video');
      video.className = 'cloud-real-video-thumb';
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-label', name);
      video.addEventListener('loadedmetadata', () => {
        try { video.currentTime = Math.min(0.15, Math.max(0, (video.duration || 1) / 20)); } catch (_) {}
      }, { once: true });
      video.addEventListener('seeked', () => video.pause(), { once: true });
      thumb.append(video);
      const badge = document.createElement('span');
      badge.className = 'cloud-thumb-badge';
      badge.textContent = '▶ VIDEO';
      thumb.append(badge);
    } else {
      const img = document.createElement('img');
      img.className = 'cloud-real-image-thumb';
      img.src = url;
      img.alt = name;
      img.loading = 'lazy';
      thumb.append(img);
      const badge = document.createElement('span');
      badge.className = 'cloud-thumb-badge image';
      badge.textContent = 'ẢNH';
      thumb.append(badge);
    }
    card.dataset.thumbState = 'ready';
  } catch (err) {
    card.dataset.thumbState = 'error';
    console.warn('Cloud thumbnail:', name, err.message);
  }
}

function hydrateVisibleCloudCards() {
  document.querySelectorAll('#visualCloudGrid .visual-cloud-card').forEach((card) => hydrateCloudCard(card));
}

function installObserver() {
  const grid = document.getElementById('visualCloudGrid');
  if (!grid) return false;
  const observer = new MutationObserver(() => {
    requestAnimationFrame(hydrateVisibleCloudCards);
  });
  observer.observe(grid, { childList: true, subtree: true });
  hydrateVisibleCloudCards();
  return true;
}

let attempts = 0;
const timer = setInterval(() => {
  attempts += 1;
  if (installObserver() || attempts > 40) clearInterval(timer);
}, 250);

window.addEventListener('ngs:library-changed', () => {
  mediaCache.loadedAt = 0;
  mediaCache.byName.clear();
  setTimeout(hydrateVisibleCloudCards, 250);
});
