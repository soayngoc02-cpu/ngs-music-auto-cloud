import { AudioTrimmer, formatAudioTime } from './audio-trim.js';

const nativeFetch = window.fetch.bind(window);
const API_BASE = () => (localStorage.getItem('ngs_api_base') || window.location.origin).replace(/\/+$/, '');
const $ = (id) => document.getElementById(id);

const musicState = {
  cloudKey: '',
  cloudName: '',
  cloudUrl: '',
  cloudTrim: null,
  localUploadedKey: '',
  localUploadedName: '',
  localUploadPromise: null,
  cloudItems: [],
  cloudBlobFile: null,
};

let cloudPreviewAudio;
let cloudTrimmer;
let nameObserver;

function basename(key) {
  return String(key || '').split('/').pop() || '—';
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

async function apiGet(path) {
  const joiner = path.includes('?') ? '&' : '?';
  const res = await nativeFetch(`${API_BASE()}${path}${joiner}_=${Date.now()}`, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function apiPost(path, payload) {
  const res = await nativeFetch(`${API_BASE()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

function setSourceActive(source) {
  document.querySelectorAll('#musicSourceSwitch button').forEach((button) => {
    button.classList.toggle('active', button.dataset.source === source);
  });
}

function setMusicName() {
  const target = $('musicName');
  if (!target || !musicState.cloudKey) return;
  let suffix = '';
  if (musicState.cloudTrim?.confirmed) {
    suffix = ` · ${formatAudioTime(musicState.cloudTrim.start)}–${formatAudioTime(musicState.cloudTrim.end)}`;
  }
  const expected = `${musicState.cloudName}${suffix}`;
  if (target.textContent !== expected) target.textContent = expected;
}

function clearCloudSelection({ keepPanel = true } = {}) {
  musicState.cloudKey = '';
  musicState.cloudName = '';
  musicState.cloudUrl = '';
  musicState.cloudTrim = null;
  musicState.cloudBlobFile = null;
  const drop = $('musicDrop');
  if (drop) {
    delete drop.dataset.cloudKey;
    delete drop.dataset.cloudName;
    delete drop.dataset.cloudTrim;
  }
  $('cloudSelectedState')?.classList.remove('show');
  if (!keepPanel) $('cloudMusicPicker')?.classList.remove('show');
  $('cloudAudioTrimCard')?.classList.remove('show');
  cloudTrimmer?.clear(true);
  const duration = $('durationSelect');
  if (duration) duration.disabled = false;
}

async function signedMediaUrl(key) {
  const result = await apiGet(`/api/media-url?key=${encodeURIComponent(key)}`);
  return result.url;
}

async function playCloudItem(item, button) {
  try {
    const url = await signedMediaUrl(item.key);
    if (!cloudPreviewAudio) cloudPreviewAudio = new Audio();
    if (cloudPreviewAudio.src !== url) cloudPreviewAudio.src = url;
    if (!cloudPreviewAudio.paused) {
      cloudPreviewAudio.pause();
      button.textContent = '▶ Nghe';
      return;
    }
    await cloudPreviewAudio.play();
    button.textContent = '❚❚ Dừng';
    cloudPreviewAudio.onpause = () => { button.textContent = '▶ Nghe'; };
    cloudPreviewAudio.onended = () => { button.textContent = '▶ Nghe'; };
  } catch (err) {
    toast(`Không phát được nhạc: ${err.message}`);
  }
}

async function selectCloudItem(item) {
  const input = $('musicInput');
  if (input) {
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  musicState.localUploadedKey = '';
  musicState.localUploadedName = '';
  clearCloudSelection();
  musicState.cloudKey = item.key;
  musicState.cloudName = basename(item.key);
  const drop = $('musicDrop');
  if (drop) {
    drop.dataset.cloudKey = musicState.cloudKey;
    drop.dataset.cloudName = musicState.cloudName;
  }
  $('cloudSelectedName').textContent = musicState.cloudName;
  $('cloudSelectedState').classList.add('show');
  setSourceActive('cloud');
  setMusicName();
  renderCloudList();
  toast(`Đang dùng nhạc Cloud: ${musicState.cloudName}`);
}

async function openCloudTrim() {
  if (!musicState.cloudKey) return toast('Chọn một bài trong Kho Cloud trước');
  try {
    $('cloudTrimStatus').textContent = 'Đang tải nhạc từ Cloud để tạo waveform…';
    $('cloudAudioTrimCard').classList.add('show');
    if (!musicState.cloudUrl) musicState.cloudUrl = await signedMediaUrl(musicState.cloudKey);
    if (!musicState.cloudBlobFile) {
      const response = await nativeFetch(musicState.cloudUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      musicState.cloudBlobFile = new File([blob], musicState.cloudName, { type: blob.type || 'audio/mpeg' });
    }
    const preferred = Number($('durationSelect')?.value || 30);
    await cloudTrimmer.loadFile(musicState.cloudBlobFile, preferred);
    cloudTrimmer.open();
  } catch (err) {
    $('cloudTrimStatus').textContent = `Không mở được waveform: ${err.message}`;
  }
}

async function uploadLocalMusic(file) {
  if (!file) return;
  const status = $('musicUploadStatus');
  try {
    if (status) status.textContent = 'Đang upload lên Cloud…';
    const signed = await apiPost('/api/upload-url', {
      kind: 'music',
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
    });
    const upload = await nativeFetch(signed.url, {
      method: signed.method || 'PUT',
      headers: signed.headers || { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!upload.ok) throw new Error(`HTTP ${upload.status}`);
    musicState.localUploadedKey = signed.key;
    musicState.localUploadedName = file.name;
    const drop = $('musicDrop');
    if (drop) {
      drop.dataset.localUploadedKey = signed.key;
      drop.dataset.localUploadedName = file.name;
    }
    if (status) status.textContent = '✓ Đã lưu vào Kho Cloud';
    window.dispatchEvent(new CustomEvent('ngs:library-changed', { detail: { kind: 'music', key: signed.key } }));
  } catch (err) {
    if (status) status.textContent = `Upload lỗi: ${err.message}`;
  }
}

function renderCloudList() {
  const host = $('cloudMusicList');
  if (!host) return;
  const query = String($('cloudMusicSearch')?.value || '').trim().toLowerCase();
  const items = musicState.cloudItems.filter((item) => basename(item.key).toLowerCase().includes(query));
  if (!items.length) {
    host.innerHTML = '<div class="cloud-music-empty">Không có bài nhạc phù hợp.</div>';
    return;
  }
  host.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = `cloud-music-row${item.key === musicState.cloudKey ? ' selected' : ''}`;
    row.innerHTML = `
      <div class="cloud-music-main">
        <strong title="${item.key.replace(/"/g, '&quot;')}">${basename(item.key)}</strong>
        <small>${formatBytes(item.size)} · ${item.uploaded ? new Date(item.uploaded).toLocaleString('vi-VN') : ''}</small>
      </div>
      <div class="cloud-music-row-actions">
        <button class="music-mini-btn cloud-play" type="button">▶ Nghe</button>
        <button class="music-mini-btn primary-mini cloud-use" type="button">Dùng</button>
      </div>
    `;
    row.querySelector('.cloud-play').addEventListener('click', (event) => playCloudItem(item, event.currentTarget));
    row.querySelector('.cloud-use').addEventListener('click', () => selectCloudItem(item));
    host.append(row);
  }
}

async function refreshCloudMusic() {
  const host = $('cloudMusicList');
  if (host) host.innerHTML = '<div class="cloud-music-empty">Đang tải Kho Cloud…</div>';
  try {
    const result = await apiGet('/api/library?kind=music');
    musicState.cloudItems = (result.objects || []).sort((a, b) => new Date(b.uploaded || 0) - new Date(a.uploaded || 0));
    if (musicState.cloudKey && !musicState.cloudItems.some((item) => item.key === musicState.cloudKey)) {
      clearCloudSelection();
      setSourceActive('auto');
    }
    renderCloudList();
  } catch (err) {
    if (host) host.innerHTML = `<div class="cloud-music-empty">Lỗi tải kho: ${err.message}</div>`;
  }
}

function installCloudTrimCard() {
  if ($('cloudAudioTrimCard')) return;
  const card = document.createElement('section');
  card.id = 'cloudAudioTrimCard';
  card.className = 'card audio-trim-card cloud-trim-card';
  card.innerHTML = `
    <div class="card-head audio-trim-head">
      <div>
        <p class="eyebrow">CLOUD AUDIO CUT</p>
        <h2>Cắt tay nhạc trong Cloud</h2>
        <p class="muted trim-status" id="cloudTrimStatus">Chọn bài Cloud rồi mở cắt tay</p>
      </div>
      <span class="pill" id="cloudTrimDurationLabel">0.0 giây</span>
    </div>
    <div class="waveform-stage" id="cloudWaveformStage">
      <canvas id="cloudWaveformCanvas"></canvas>
      <div class="waveform-selection" id="cloudWaveformSelection"></div>
      <button class="trim-handle trim-handle-start" id="cloudTrimStartHandle" type="button"><span></span></button>
      <button class="trim-handle trim-handle-end" id="cloudTrimEndHandle" type="button"><span></span></button>
    </div>
    <div class="trim-time-row">
      <strong><span class="trim-dot start"></span> Bắt đầu: <span id="cloudTrimStartLabel">0:00.0</span></strong>
      <strong>Kết thúc: <span id="cloudTrimEndLabel">0:00.0</span> <span class="trim-dot end"></span></strong>
    </div>
    <div class="trim-controls">
      <button class="secondary trim-play" id="cloudTrimPlayBtn" type="button">▶ Nghe đoạn chọn</button>
      <div class="trim-number-grid">
        <label>Điểm đầu (giây)<input id="cloudTrimStartInput" type="number" min="0" step="0.1" value="0.0" /></label>
        <label>Điểm cuối (giây)<input id="cloudTrimEndInput" type="number" min="0" step="0.1" value="0.0" /></label>
      </div>
      <div class="trim-actions">
        <button class="ghost" id="cloudTrimCancelBtn" type="button">Dùng từ đầu</button>
        <button class="primary trim-use" id="cloudTrimUseBtn" type="button">Dùng đoạn này</button>
      </div>
    </div>
    <audio id="cloudTrimAudioPlayer" preload="metadata"></audio>
  `;
  const firstGrid = document.querySelector('#view-render > .grid.two');
  firstGrid?.insertAdjacentElement('afterend', card);

  cloudTrimmer = new AudioTrimmer({
    rootId: 'cloudAudioTrimCard',
    canvasId: 'cloudWaveformCanvas',
    stageId: 'cloudWaveformStage',
    selectionId: 'cloudWaveformSelection',
    startHandleId: 'cloudTrimStartHandle',
    endHandleId: 'cloudTrimEndHandle',
    startInputId: 'cloudTrimStartInput',
    endInputId: 'cloudTrimEndInput',
    startLabelId: 'cloudTrimStartLabel',
    endLabelId: 'cloudTrimEndLabel',
    durationLabelId: 'cloudTrimDurationLabel',
    playButtonId: 'cloudTrimPlayBtn',
    useButtonId: 'cloudTrimUseBtn',
    cancelButtonId: 'cloudTrimCancelBtn',
    audioId: 'cloudTrimAudioPlayer',
    statusId: 'cloudTrimStatus',
    onChange: (selection) => {
      musicState.cloudTrim = selection;
      if ($('musicDrop')) $('musicDrop').dataset.cloudTrim = JSON.stringify(selection);
      setMusicName();
    },
    onUse: (selection) => {
      musicState.cloudTrim = selection;
      if ($('musicDrop')) $('musicDrop').dataset.cloudTrim = JSON.stringify(selection);
      if ($('durationSelect')) $('durationSelect').disabled = true;
      setMusicName();
      toast(`Đã dùng đoạn ${formatAudioTime(selection.start)}–${formatAudioTime(selection.end)}`);
    },
    onCancel: () => {
      musicState.cloudTrim = null;
      if ($('musicDrop')) delete $('musicDrop').dataset.cloudTrim;
      if ($('durationSelect')) $('durationSelect').disabled = false;
      cloudTrimmer.hide();
      setMusicName();
      toast('Đã dùng nhạc Cloud từ đầu');
    },
  });
}

function installMusicPicker() {
  const drop = $('musicDrop');
  if (!drop || $('musicSourceSwitch')) return;

  const sourceSwitch = document.createElement('div');
  sourceSwitch.id = 'musicSourceSwitch';
  sourceSwitch.className = 'music-source-switch';
  sourceSwitch.innerHTML = `
    <button type="button" class="active" data-source="auto">Auto</button>
    <button type="button" data-source="cloud">Kho Cloud</button>
    <button type="button" data-source="local">Máy tính</button>
  `;
  const localButton = drop.querySelector('[data-pick="musicInput"]');
  if (localButton) localButton.textContent = 'Chọn nhạc trên máy';
  drop.insertBefore(sourceSwitch, localButton || drop.lastChild);

  const status = document.createElement('div');
  status.id = 'musicUploadStatus';
  status.className = 'music-upload-status';
  drop.append(status);

  const selected = document.createElement('div');
  selected.id = 'cloudSelectedState';
  selected.className = 'music-cloud-state';
  selected.innerHTML = `
    <strong id="cloudSelectedName">Chưa chọn nhạc Cloud</strong>
    <div class="music-cloud-actions">
      <button class="music-mini-btn" id="cloudSelectedPlay" type="button">▶ Nghe</button>
      <button class="music-mini-btn" id="cloudSelectedTrim" type="button">✂ Cắt tay</button>
      <button class="music-mini-btn" id="cloudSelectedChange" type="button">Đổi bài</button>
    </div>
  `;
  drop.append(selected);

  const picker = document.createElement('section');
  picker.id = 'cloudMusicPicker';
  picker.className = 'card cloud-music-picker';
  picker.innerHTML = `
    <div class="card-head">
      <div><p class="eyebrow">CLOUD MUSIC</p><h2>Chọn nhạc có sẵn trên Cloud</h2></div>
      <button class="ghost small" id="closeCloudMusicPicker" type="button">Đóng</button>
    </div>
    <div class="cloud-music-toolbar">
      <label>Tìm bài nhạc<input id="cloudMusicSearch" type="search" placeholder="Nhập tên bài..." /></label>
      <button class="ghost" id="refreshCloudMusic" type="button">↻ Làm mới</button>
    </div>
    <div class="cloud-music-list" id="cloudMusicList"></div>
  `;
  document.querySelector('#view-render > .grid.two')?.insertAdjacentElement('afterend', picker);

  sourceSwitch.querySelector('[data-source="auto"]').addEventListener('click', () => {
    clearCloudSelection({ keepPanel: false });
    musicState.localUploadedKey = '';
    musicState.localUploadedName = '';
    $('clearMusicBtn')?.click();
    setSourceActive('auto');
    if ($('musicUploadStatus')) $('musicUploadStatus').textContent = '';
  });
  sourceSwitch.querySelector('[data-source="cloud"]').addEventListener('click', () => {
    setSourceActive('cloud');
    picker.classList.add('show');
    refreshCloudMusic();
  });
  sourceSwitch.querySelector('[data-source="local"]').addEventListener('click', () => {
    clearCloudSelection({ keepPanel: false });
    setSourceActive('local');
    localButton?.click();
  });

  $('closeCloudMusicPicker').addEventListener('click', () => picker.classList.remove('show'));
  $('refreshCloudMusic').addEventListener('click', refreshCloudMusic);
  $('cloudMusicSearch').addEventListener('input', renderCloudList);
  $('cloudSelectedChange').addEventListener('click', () => { picker.classList.add('show'); refreshCloudMusic(); });
  $('cloudSelectedTrim').addEventListener('click', openCloudTrim);
  $('cloudSelectedPlay').addEventListener('click', async (event) => {
    if (!musicState.cloudKey) return;
    await playCloudItem({ key: musicState.cloudKey }, event.currentTarget);
  });

  $('musicInput')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    clearCloudSelection({ keepPanel: false });
    setSourceActive('local');
    musicState.localUploadPromise = uploadLocalMusic(file);
  });

  $('clearMusicBtn')?.addEventListener('click', () => {
    clearCloudSelection({ keepPanel: false });
    musicState.localUploadedKey = '';
    musicState.localUploadedName = '';
    if ($('musicDrop')) {
      delete $('musicDrop').dataset.localUploadedKey;
      delete $('musicDrop').dataset.localUploadedName;
    }
    setSourceActive('auto');
    if ($('musicUploadStatus')) $('musicUploadStatus').textContent = '';
  });

  nameObserver = new MutationObserver(() => setMusicName());
  if ($('musicName')) nameObserver.observe($('musicName'), { childList: true, characterData: true, subtree: true });

  window.addEventListener('ngs:library-changed', (event) => {
    if (event.detail?.kind === 'music') {
      if (event.detail.key && event.detail.key === musicState.cloudKey) clearCloudSelection();
      if (picker.classList.contains('show')) refreshCloudMusic();
    }
  });

  installCloudTrimCard();
}

function patchFetchForMusicSelection() {
  window.fetch = async function patchedFetch(input, init = {}) {
    const rawUrl = typeof input === 'string' ? input : input?.url || '';
    if (rawUrl === 'ngs-uploaded://music') return new Response('', { status: 200 });

    let pathname = rawUrl;
    try { pathname = new URL(rawUrl, window.location.origin).pathname; } catch (_) {}
    const method = String(init?.method || 'GET').toUpperCase();

    if (pathname === '/api/upload-url' && method === 'POST' && musicState.localUploadedKey) {
      try {
        const body = JSON.parse(init.body || '{}');
        if (body.kind === 'music' && body.filename === musicState.localUploadedName) {
          return new Response(JSON.stringify({
            ok: true,
            key: musicState.localUploadedKey,
            url: 'ngs-uploaded://music',
            method: 'PUT',
            headers: {},
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      } catch (_) {}
    }

    if (pathname === '/api/jobs' && method === 'POST' && musicState.cloudKey) {
      try {
        const payload = JSON.parse(init.body || '{}');
        payload.audio_key = musicState.cloudKey;
        if (musicState.cloudTrim?.confirmed) {
          payload.music_mode = 'manual';
          payload.audio_start_sec = musicState.cloudTrim.start;
          payload.audio_end_sec = musicState.cloudTrim.end;
          payload.duration_sec = musicState.cloudTrim.duration;
        } else {
          payload.music_mode = 'file';
          payload.audio_start_sec = 0;
          payload.audio_end_sec = 0;
        }
        return nativeFetch(input, { ...init, body: JSON.stringify(payload) });
      } catch (_) {}
    }

    return nativeFetch(input, init);
  };
}

patchFetchForMusicSelection();
installMusicPicker();
setTimeout(refreshCloudMusic, 500);
