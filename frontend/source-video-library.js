const API_BASE = () => (localStorage.getItem('ngs_api_base') || window.location.origin).replace(/\/+$/, '');
const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const url = `${API_BASE()}${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store', ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
function basename(key) { return String(key || '').split('/').pop() || '—'; }
function bytes(v) { const n = Number(v || 0); return n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`; }
function esc(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function install() {
  const view = $('view-library');
  if (!view || $('sourceVideoLibraryCard')) return;
  const card = document.createElement('section');
  card.className = 'card';
  card.id = 'sourceVideoLibraryCard';
  card.innerHTML = `<div class="card-head"><div><h2>Kho video nguồn</h2><p class="muted">Video dùng làm visual, khác với Video hoàn thành.</p></div><button class="ghost small" id="refreshSourceVideos" type="button">Làm mới</button></div><div id="sourceVideoLibrary" class="list-state">Chưa tải dữ liệu</div>`;
  const lyricsCard = $('lyricsLibrary')?.closest('.card');
  if (lyricsCard) lyricsCard.insertAdjacentElement('beforebegin', card); else view.append(card);
  $('refreshSourceVideos').addEventListener('click', refresh);
}

async function openVideo(key) {
  try {
    const result = await api(`/api/media-url?key=${encodeURIComponent(key)}`);
    window.open(result.url, '_blank', 'noopener');
  } catch (err) { alert(`Không mở được video: ${err.message}`); }
}

async function removeVideo(item, button) {
  if (!confirm(`Xóa video nguồn khỏi Cloud?\n\n${basename(item.key)}\n\nThao tác này không thể hoàn tác.`)) return;
  button.disabled = true;
  try {
    await api('/api/delete-media', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'source_video', key: item.key }),
    });
    window.dispatchEvent(new CustomEvent('ngs:library-changed', { detail: { kind: 'video', key: item.key } }));
    await refresh();
  } catch (err) { alert(`Không xóa được: ${err.message}`); button.disabled = false; }
}

async function refresh() {
  install();
  const host = $('sourceVideoLibrary');
  if (!host) return;
  host.innerHTML = '<div class="manager-loading">Đang đồng bộ R2…</div>';
  try {
    const result = await api('/api/library?kind=video');
    if (!result.objects?.length) { host.innerHTML = '<div class="manager-empty">Kho video nguồn đang trống.</div>'; return; }
    host.innerHTML = '';
    for (const item of result.objects) {
      const row = document.createElement('div');
      row.className = 'media-row manager-media-row';
      row.innerHTML = `<div class="manager-media-main"><strong title="${esc(item.key)}">${esc(basename(item.key))}</strong><small>Video nguồn · ${esc(bytes(item.size))}</small></div><div class="manager-media-actions"><button class="secondary source-video-open" type="button">Xem</button><button class="danger-small source-video-delete" type="button">Xóa</button></div>`;
      row.querySelector('.source-video-open').addEventListener('click', () => openVideo(item.key));
      row.querySelector('.source-video-delete').addEventListener('click', (e) => removeVideo(item, e.currentTarget));
      host.append(row);
    }
  } catch (err) { host.innerHTML = `<div class="manager-error">Lỗi: ${esc(err.message)}</div>`; }
}

install();
document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.view === 'library') setTimeout(refresh, 0);
}));
window.addEventListener('ngs:library-changed', (event) => { if (event.detail?.kind === 'video') refresh(); });
setTimeout(refresh, 450);
