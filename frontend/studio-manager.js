const MANAGER_API_BASE = () => (localStorage.getItem('ngs_api_base') || window.location.origin).replace(/\/+$/, '');
const q = (selector, root = document) => root.querySelector(selector);

let completedItems = [];
let lastLibraryRefresh = 0;
let lastCompletedRefresh = 0;

function ensureManagerStyles() {
  if (document.querySelector('link[data-studio-manager]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './studio-manager.css';
  link.dataset.studioManager = '1';
  document.head.append(link);
}

async function managerGet(path) {
  const joiner = path.includes('?') ? '&' : '?';
  const res = await fetch(`${MANAGER_API_BASE()}${path}${joiner}_=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(value) {
  if (!value) return 'Không rõ thời gian';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('vi-VN', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatDuration(sec) {
  const value = Number(sec || 0);
  if (!value) return 'Toàn bài';
  const m = Math.floor(value / 60);
  const s = Math.round((value - m * 60) * 10) / 10;
  return m ? `${m}:${String(s.toFixed(s % 1 ? 1 : 0)).padStart(2, '0')}` : `${s}s`;
}

function basename(key) {
  return String(key || '').split('/').pop() || '—';
}

async function refreshLibraryKind(kind) {
  const map = { music: 'musicLibrary', image: 'imageLibrary', lyrics: 'lyricsLibrary' };
  const host = document.getElementById(map[kind]);
  if (!host) return;
  host.innerHTML = '<div class="manager-loading">Đang đồng bộ R2…</div>';
  try {
    const result = await managerGet(`/api/library?kind=${encodeURIComponent(kind)}`);
    if (!result.objects?.length) {
      host.innerHTML = '<div class="manager-empty">Kho đang trống.</div>';
      return;
    }
    host.innerHTML = '';
    for (const item of result.objects) {
      const row = document.createElement('div');
      row.className = 'media-row manager-media-row';
      row.innerHTML = `
        <div class="manager-media-main">
          <strong title="${escapeHtml(item.key)}">${escapeHtml(basename(item.key))}</strong>
          <small>${escapeHtml(formatDate(item.uploaded))}</small>
        </div>
        <span>${escapeHtml(formatBytes(item.size))}</span>
      `;
      host.append(row);
    }
  } catch (err) {
    host.innerHTML = `<div class="manager-error">Lỗi đồng bộ: ${escapeHtml(err.message)}</div>`;
  }
}

async function refreshLibraries(force = false) {
  if (!force && Date.now() - lastLibraryRefresh < 5000) return;
  lastLibraryRefresh = Date.now();
  await Promise.allSettled([
    refreshLibraryKind('music'),
    refreshLibraryKind('image'),
    refreshLibraryKind('lyrics'),
  ]);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function installCompletedManager() {
  const view = document.getElementById('view-outputs');
  if (!view || document.getElementById('completedGrid')) return;
  view.innerHTML = `
    <section class="card completed-manager-card">
      <div class="card-head completed-manager-head">
        <div>
          <p class="eyebrow">RENDER LIBRARY</p>
          <h2>Video hoàn thành</h2>
          <p class="muted">Tự động cập nhật từ R2. Mỗi lần render có một phiên bản riêng.</p>
        </div>
        <button class="ghost" id="refreshCompletedBtn" type="button">↻ Làm mới</button>
      </div>
      <div class="completed-toolbar">
        <label class="completed-search">Tìm video
          <input id="completedSearch" type="search" placeholder="C001, tên nhạc, render ID…" autocomplete="off" />
        </label>
        <div class="completed-count" id="completedCount">0 video</div>
      </div>
      <div class="completed-grid" id="completedGrid">
        <div class="manager-loading">Đang tải video hoàn thành…</div>
      </div>
    </section>
  `;

  q('#refreshCompletedBtn')?.addEventListener('click', () => refreshCompleted(true));
  q('#completedSearch')?.addEventListener('input', renderCompleted);
}

function renderCompleted() {
  const grid = document.getElementById('completedGrid');
  if (!grid) return;
  const search = String(document.getElementById('completedSearch')?.value || '').trim().toLowerCase();
  const filtered = completedItems.filter((item) => {
    if (!search) return true;
    return [item.job_id, item.render_id, item.audio_key, item.output_key]
      .some((value) => String(value || '').toLowerCase().includes(search));
  });

  document.getElementById('completedCount').textContent = `${filtered.length} video`;
  if (!filtered.length) {
    grid.innerHTML = '<div class="manager-empty completed-empty">Không có video phù hợp.</div>';
    return;
  }

  grid.innerHTML = '';
  filtered.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'completed-video-card';
    const resolution = item.width && item.height ? `${item.width}×${item.height}` : (item.aspect_ratio || '—');
    const trimText = Number(item.audio_start_sec || 0) > 0
      ? `Cắt từ ${Number(item.audio_start_sec).toFixed(1)}s`
      : (item.music_mode === 'manual' ? 'Cắt tay' : 'Từ đầu');
    const videoId = `completed-video-${index}`;

    card.innerHTML = `
      <div class="completed-preview-wrap">
        <video id="${videoId}" class="completed-preview" preload="none" controls playsinline poster="${escapeHtml(item.image_url || '')}">
          <source src="${escapeHtml(item.view_url || '')}" type="video/mp4" />
        </video>
        <span class="completed-code">${escapeHtml(item.job_id || '—')}</span>
      </div>
      <div class="completed-body">
        <div class="completed-title-row">
          <strong>${escapeHtml(item.job_id || 'Không mã')}</strong>
          <span>${escapeHtml(formatDuration(item.duration_sec))}</span>
        </div>
        <div class="completed-meta">
          <span>${escapeHtml(resolution)}</span>
          <span>${escapeHtml(String(item.quality || '').toUpperCase() || '—')}</span>
          <span>${escapeHtml(`${item.fps || 0} FPS`)}</span>
        </div>
        <div class="completed-track" title="${escapeHtml(item.audio_key)}">♫ ${escapeHtml(basename(item.audio_key))}</div>
        <div class="completed-trim">${escapeHtml(trimText)}</div>
        <div class="completed-time">${escapeHtml(formatDate(item.completed_at))}</div>
        <div class="completed-version" title="${escapeHtml(item.render_id)}">${escapeHtml(item.render_id || '')}</div>
        <div class="completed-actions">
          <a class="secondary manager-link" href="${escapeHtml(item.view_url)}" target="_blank" rel="noopener">Xem lớn</a>
          <a class="primary manager-link" href="${escapeHtml(item.download_url)}" target="_blank" rel="noopener">Tải MP4</a>
        </div>
      </div>
    `;
    grid.append(card);
  });
}

async function refreshCompleted(force = false) {
  installCompletedManager();
  if (!force && Date.now() - lastCompletedRefresh < 4000) return;
  lastCompletedRefresh = Date.now();
  const grid = document.getElementById('completedGrid');
  if (grid) grid.innerHTML = '<div class="manager-loading">Đang đồng bộ danh sách video…</div>';
  try {
    const result = await managerGet('/api/completed?limit=48');
    completedItems = result.items || [];
    renderCompleted();
  } catch (err) {
    if (grid) grid.innerHTML = `<div class="manager-error">Không tải được video: ${escapeHtml(err.message)}</div>`;
  }
}

function currentView() {
  return document.querySelector('.nav-item.active')?.dataset.view || 'render';
}

function wireAutoRefresh() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      if (view === 'library') setTimeout(() => refreshLibraries(true), 0);
      if (view === 'outputs') setTimeout(() => refreshCompleted(true), 0);
    });
  });

  // Existing manual refresh buttons now always bypass browser/API caches too.
  document.querySelectorAll('[data-load-library]').forEach((button) => {
    button.addEventListener('click', () => setTimeout(() => refreshLibraryKind(button.dataset.loadLibrary), 0));
  });

  window.addEventListener('focus', () => {
    if (currentView() === 'library') refreshLibraries();
    if (currentView() === 'outputs') refreshCompleted();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (currentView() === 'library') refreshLibraries();
    if (currentView() === 'outputs') refreshCompleted();
  });

  const status = document.getElementById('jobStatusPill');
  if (status) {
    const observer = new MutationObserver(() => {
      if (status.textContent.trim().toLowerCase() === 'done') {
        setTimeout(() => refreshCompleted(true), 800);
        setTimeout(() => refreshLibraries(true), 800);
      }
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
  }
}

ensureManagerStyles();
installCompletedManager();
wireAutoRefresh();

// Warm the data on every fresh page load so tabs are current when opened.
setTimeout(() => {
  refreshLibraries(true);
  refreshCompleted(true);
}, 250);
