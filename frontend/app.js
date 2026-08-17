const $ = (id) => document.getElementById(id);

const state = {
  apiBase: localStorage.getItem('ngs_api_base') || window.location.origin,
  aspect: '9:16',
  quality: '1080',
  lyricsSource: 'auto',
  imageFile: null,
  musicFile: null,
  lyricsFile: null,
  uploadedImageKey: '',
  uploadedMusicKey: '',
  uploadedLyricsKey: '',
  currentJobId: '',
  pollTimer: null,
};

const PRESETS = {
  '9:16': { '1080': [1080, 1920], '2k': [1440, 2560], '4k': [2160, 3840] },
  '1:1': { '1080': [1080, 1080], '2k': [1440, 1440], '4k': [2160, 2160] },
  '16:9': { '1080': [1920, 1080], '2k': [2560, 1440], '4k': [3840, 2160] },
};

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

function normalizeBase(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

async function api(path, options = {}) {
  const res = await fetch(`${state.apiBase}${path}`, options);
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = typeof body === 'object' ? (body.error || JSON.stringify(body)) : body;
    throw new Error(message || `HTTP ${res.status}`);
  }
  return body;
}

function setApiStatus(ok, text) {
  $('apiDot').className = `dot ${ok ? 'online' : 'offline'}`;
  $('apiStatus').textContent = text;
  $('openSettingsBtn').textContent = ok ? 'Cloud API online' : 'Kiểm tra API';
}

async function checkApi() {
  try {
    const data = await api('/api/health');
    const githubText = data.github_actions === 'ready' ? 'GitHub Actions sẵn sàng' : 'Thiếu GitHub token';
    setApiStatus(true, `R2 OK · ${githubText}`);
    $('settingsResult').textContent = `API tích hợp OK: ${state.apiBase}\nR2: ${data.r2}\nGitHub Actions: ${data.github_actions}`;
    return data.github_actions === 'ready';
  } catch (err) {
    setApiStatus(false, 'Cloud API chưa cấu hình');
    $('settingsResult').textContent = `API chưa sẵn sàng: ${err.message}`;
    return false;
  }
}

function updateOutputSummary() {
  const [w, h] = PRESETS[state.aspect][state.quality];
  $('resolutionBadge').textContent = `${w} × ${h}`;
  const qLabel = state.quality === '1080' ? '1080p' : state.quality.toUpperCase();
  const duration = Number($('durationSelect').value);
  const durationText = duration ? `${duration} giây` : 'Toàn bài';
  $('renderSummary').textContent = `${state.aspect} · ${qLabel} · ${durationText} · ${$('fpsSelect').value} FPS`;
  $('previewFrame').className = `preview-frame ratio-${state.aspect.replace(':', '-')}${state.imageFile ? ' has-image' : ''}`;
}

function activateChoice(containerId, value) {
  const root = $(containerId);
  root.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === value));
}

function navigate(view) {
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  $(`view-${view}`).classList.add('active');
  const labels = { render: 'Tạo video', library: 'Kho media', queue: 'Hàng đợi', outputs: 'Video hoàn thành', settings: 'Cài đặt' };
  $('pageTitle').textContent = labels[view] || 'NGS Music Studio';
}

function updateFileUi() {
  $('imageName').textContent = state.imageFile ? state.imageFile.name : 'Chưa chọn hình';
  $('musicName').textContent = state.musicFile ? state.musicFile.name : 'Auto Music Selector';
  $('lyricsName').textContent = state.lyricsFile ? state.lyricsFile.name : 'Chưa chọn file';
  $('renderHint').textContent = state.imageFile ? 'Sẵn sàng tạo job' : 'Chọn hình để bắt đầu';
}

function previewSelectedImage(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  $('previewImage').src = url;
  $('previewFrame').classList.add('has-image');
}

async function uploadFile(kind, file) {
  if (!file) return '';
  const signed = await api('/api/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind,
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
    }),
  });

  const upload = await fetch(signed.url, {
    method: signed.method || 'PUT',
    headers: signed.headers || { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!upload.ok) throw new Error(`Upload R2 thất bại: HTTP ${upload.status}`);
  return signed.key;
}

function setProgress(status, message) {
  $('jobProgressCard').hidden = false;
  $('jobStatusPill').textContent = status;
  $('jobProgressTitle').textContent = message;
  const widths = { pending: '24%', processing: '52%', rendering: '72%', done: '100%', failed: '100%', dispatch_failed: '100%' };
  $('progressBar').style.width = widths[status] || '40%';
  const row = document.createElement('div');
  row.textContent = `• ${new Date().toLocaleTimeString('vi-VN')} — ${message}`;
  $('jobLog').prepend(row);
}

async function getOutputUrl(jobId) {
  const result = await api(`/api/output-url?id=${encodeURIComponent(jobId)}`);
  return result.url;
}

async function renderVideo() {
  const jobId = $('jobId').value.trim();
  if (!jobId) return toast('Nhập mã nội dung');
  if (!state.imageFile && !state.uploadedImageKey) return toast('Chọn hình trước');
  if (!(await checkApi())) return toast('Cloud API chưa đủ cấu hình để render');

  $('renderBtn').disabled = true;
  $('renderBtn').textContent = 'ĐANG GỬI...';
  $('jobLog').innerHTML = '';
  $('jobActions').hidden = true;

  try {
    setProgress('pending', 'Đang upload asset trực tiếp vào R2');
    if (state.imageFile) {
      state.uploadedImageKey = await uploadFile('image', state.imageFile);
      setProgress('pending', `Đã upload hình: ${state.uploadedImageKey}`);
    }
    if (state.musicFile) {
      state.uploadedMusicKey = await uploadFile('music', state.musicFile);
      setProgress('pending', `Đã upload nhạc: ${state.uploadedMusicKey}`);
    }
    if (state.lyricsSource === 'r2' && state.lyricsFile) {
      state.uploadedLyricsKey = await uploadFile('lyrics', state.lyricsFile);
      setProgress('pending', `Đã upload lyrics: ${state.uploadedLyricsKey}`);
    }

    const payload = {
      job_id: jobId,
      image_key: state.uploadedImageKey,
      audio_key: state.uploadedMusicKey,
      aspect_ratio: state.aspect,
      quality: state.quality,
      fps: Number($('fpsSelect').value),
      duration_sec: Number($('durationSelect').value),
      lyrics: {
        source: state.lyricsSource,
        key: state.uploadedLyricsKey,
        text: state.lyricsSource === 'pasted' ? $('lyricsText').value : '',
        use_for_analysis: $('useLyricsAnalysis').checked,
        render: $('renderLyrics').checked,
      },
    };

    setProgress('pending', 'Đang tạo Render Job');
    const created = await api('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    state.currentJobId = jobId;
    setProgress('processing', `Job ${jobId} đã gửi lên GitHub Actions`);
    toast(`Đã tạo ${created.job_key}`);
    startPolling(jobId);
  } catch (err) {
    setProgress('failed', `Lỗi: ${err.message}`);
    toast(err.message);
  } finally {
    $('renderBtn').disabled = false;
    $('renderBtn').textContent = 'RENDER VIDEO';
  }
}

function startPolling(jobId) {
  clearInterval(state.pollTimer);
  let ticks = 0;
  state.pollTimer = setInterval(async () => {
    ticks += 1;
    try {
      const result = await api(`/api/job-status?id=${encodeURIComponent(jobId)}`);
      const status = result.status;
      if (status === 'done') {
        clearInterval(state.pollTimer);
        setProgress('done', 'Render hoàn tất');
        const outputUrl = await getOutputUrl(jobId);
        $('watchVideoBtn').href = outputUrl;
        $('jobActions').hidden = false;
        toast('Video đã render xong');
      } else if (status === 'failed') {
        clearInterval(state.pollTimer);
        setProgress('failed', result.job?.error || 'Render thất bại');
      } else {
        if (ticks % 3 === 0) setProgress('rendering', `Cloud đang xử lý ${jobId}`);
      }
    } catch (err) {
      if (ticks % 5 === 0) setProgress('processing', `Đang chờ trạng thái: ${err.message}`);
    }
  }, 5000);
}

async function loadLibrary(kind) {
  const map = { music: 'musicLibrary', image: 'imageLibrary', lyrics: 'lyricsLibrary' };
  const el = $(map[kind]);
  el.textContent = 'Đang tải...';
  try {
    const result = await api(`/api/library?kind=${encodeURIComponent(kind)}`);
    if (!result.objects.length) {
      el.textContent = 'Kho đang trống.';
      return;
    }
    el.innerHTML = '';
    for (const item of result.objects) {
      const row = document.createElement('div');
      row.className = 'media-row';
      const name = document.createElement('strong');
      name.textContent = item.key;
      const size = document.createElement('span');
      size.textContent = `${(item.size / 1024 / 1024).toFixed(2)} MB`;
      row.append(name, size);
      el.append(row);
    }
  } catch (err) {
    el.textContent = `Lỗi: ${err.message}`;
  }
}

async function checkQueueJob() {
  const id = $('queueJobId').value.trim();
  if (!id) return;
  try {
    const result = await api(`/api/job-status?id=${encodeURIComponent(id)}`);
    $('queueResult').textContent = JSON.stringify(result, null, 2);
  } catch (err) {
    $('queueResult').textContent = `Lỗi: ${err.message}`;
  }
}

function wireUi() {
  document.querySelectorAll('.nav-item').forEach((btn) => btn.addEventListener('click', () => navigate(btn.dataset.view)));
  $('openSettingsBtn').addEventListener('click', () => navigate('settings'));
  $('refreshBtn').addEventListener('click', () => checkApi());

  document.querySelectorAll('[data-pick]').forEach((btn) => btn.addEventListener('click', () => $(btn.dataset.pick).click()));

  $('imageInput').addEventListener('change', (e) => {
    state.imageFile = e.target.files[0] || null;
    state.uploadedImageKey = '';
    updateFileUi();
    previewSelectedImage(state.imageFile);
  });
  $('musicInput').addEventListener('change', (e) => {
    state.musicFile = e.target.files[0] || null;
    state.uploadedMusicKey = '';
    updateFileUi();
  });
  $('lyricsInput').addEventListener('change', (e) => {
    state.lyricsFile = e.target.files[0] || null;
    state.uploadedLyricsKey = '';
    updateFileUi();
  });
  $('clearMusicBtn').addEventListener('click', () => {
    state.musicFile = null;
    state.uploadedMusicKey = '';
    $('musicInput').value = '';
    updateFileUi();
  });

  $('aspectChoices').querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
    state.aspect = btn.dataset.value;
    activateChoice('aspectChoices', state.aspect);
    updateOutputSummary();
  }));
  $('qualityChoices').querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
    state.quality = btn.dataset.value;
    activateChoice('qualityChoices', state.quality);
    updateOutputSummary();
  }));
  $('durationSelect').addEventListener('change', updateOutputSummary);
  $('fpsSelect').addEventListener('change', updateOutputSummary);

  $('lyricsSource').querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
    state.lyricsSource = btn.dataset.value;
    activateChoice('lyricsSource', state.lyricsSource);
    $('lyricsText').hidden = state.lyricsSource !== 'pasted';
    $('lyricsUpload').hidden = state.lyricsSource !== 'r2';
  }));

  $('renderBtn').addEventListener('click', renderVideo);
  document.querySelectorAll('[data-load-library]').forEach((btn) => btn.addEventListener('click', () => loadLibrary(btn.dataset.loadLibrary)));
  $('checkJobBtn').addEventListener('click', checkQueueJob);
  $('openOutputBtn').addEventListener('click', async () => {
    const id = $('outputJobId').value.trim();
    if (!id) return toast('Nhập mã job');
    try {
      const url = await getOutputUrl(id);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast(err.message);
    }
  });

  $('saveApiBtn').addEventListener('click', async () => {
    state.apiBase = normalizeBase($('apiBaseInput').value) || window.location.origin;
    localStorage.setItem('ngs_api_base', state.apiBase);
    await checkApi();
  });
  $('clearApiBtn').addEventListener('click', async () => {
    state.apiBase = window.location.origin;
    localStorage.removeItem('ngs_api_base');
    $('apiBaseInput').value = state.apiBase;
    await checkApi();
  });
}

wireUi();
$('apiBaseInput').value = state.apiBase;
updateFileUi();
updateOutputSummary();
checkApi();
