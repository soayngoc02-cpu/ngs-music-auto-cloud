const previousFetch = window.fetch.bind(window);
const $ = (id) => document.getElementById(id);

const EFFECTS = [
  ['none', 'Không hiệu ứng', 'Ảnh sạch, không chuyển động'],
  ['zoom_in', 'Zoom In', 'Phóng chậm vào chủ thể'],
  ['zoom_out', 'Zoom Out', 'Lùi chậm khỏi chủ thể'],
  ['pan_left', 'Pan trái', 'Trượt khung hình sang trái'],
  ['pan_right', 'Pan phải', 'Trượt khung hình sang phải'],
  ['pan_up', 'Pan lên', 'Trượt khung hình lên'],
  ['pan_down', 'Pan xuống', 'Trượt khung hình xuống'],
  ['drift', 'Drift', 'Trôi nhẹ đa hướng'],
  ['pulse', 'Pulse', 'Nhịp zoom mềm theo thời gian'],
  ['ken_burns', 'Ken Burns', 'Zoom + pan điện ảnh'],
  ['cinematic', 'Cinematic', 'Tương phản, vignette, zoom điện ảnh'],
  ['dreamy', 'Dreamy', 'Mềm, sáng, mơ màng'],
  ['soft_glow', 'Soft Glow', 'Ánh sáng mềm và chuyển động nhẹ'],
  ['vignette', 'Vignette', 'Tập trung ánh nhìn vào trung tâm'],
  ['film_grain', 'Film Grain', 'Hạt phim và màu điện ảnh'],
  ['warm_film', 'Warm Film', 'Tông ấm, Ken Burns'],
  ['cool_night', 'Cool Night', 'Tông lạnh, drift chậm'],
  ['vintage', 'Vintage', 'Màu cũ, grain nhẹ'],
  ['lofi', 'Lo-fi', 'Màu dịu, hạt nhẹ, drift'],
  ['dramatic', 'Dramatic', 'Tương phản mạnh, tối viền'],
  ['monochrome', 'Monochrome', 'Đen trắng tương phản'],
  ['dynamic_mix', 'Dynamic Mix', 'Drift + màu + vignette + grain'],
];

const SUB_STYLES = [
  ['clean_pro', 'Clean Pro'],
  ['tiktok_pop', 'TikTok Pop'],
  ['neon_glow', 'Neon Glow'],
  ['cinema', 'Cinema'],
  ['glass_box', 'Glass Box'],
  ['gold', 'Gold'],
  ['heavy_outline', 'Heavy Outline'],
  ['minimal', 'Minimal'],
];

const fxState = {
  mode: 'auto',
  preset: 'cinematic',
  intensity: 0.65,
  subtitleEnabled: false,
  subtitleStyle: 'clean_pro',
  subtitleAnimation: 'fade',
  subtitlePosition: 'bottom',
  subtitleSize: 'large',
  subtitleMaxLines: 2,
  subtitleSyncMode: 'smart',
  subtitleModel: 'small',
  subtitleLanguage: 'vi',
  subtitleMinConfidence: 0.38,
  subtitleFontSize: 68,
  subtitleYPercent: 78,
  subtitleSafeWidthPercent: 84,
};

let liveDragActive = false;
let previewResizeObserver;

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function previewLyricText() {
  const pasted = $('lyricsText')?.value || '';
  const lines = pasted.replace(/\r/g, '').split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^\[[^\]]+\]$/.test(line));
  if (lines.length) return lines[0].replace(/^\[\d{1,2}:\d{2}(?:\.\d+)?\]\s*/, '');
  return 'Chén đắng chưa vơi, màu mây đã nhòa';
}

function ensureLiveSubtitlePreview() {
  const frame = $('previewFrame');
  if (!frame || $('liveSubtitleOverlay')) return;

  const safe = document.createElement('div');
  safe.id = 'liveSubtitleSafeArea';
  safe.className = 'live-subtitle-safe-area';
  safe.innerHTML = '<span>SAFE AREA</span>';

  const overlay = document.createElement('div');
  overlay.id = 'liveSubtitleOverlay';
  overlay.className = 'live-subtitle-overlay style-clean_pro';
  overlay.title = 'Kéo lên / xuống để đặt vị trí sub';
  overlay.innerHTML = '<span id="liveSubtitleText"></span><i>↕ kéo</i>';

  frame.append(safe, overlay);

  overlay.addEventListener('pointerdown', (event) => {
    if (!fxState.subtitleEnabled) return;
    liveDragActive = true;
    overlay.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    setLiveSubtitleYFromPointer(event.clientY);
  });
  overlay.addEventListener('pointermove', (event) => {
    if (!liveDragActive) return;
    event.preventDefault();
    setLiveSubtitleYFromPointer(event.clientY);
  });
  const stop = () => { liveDragActive = false; };
  overlay.addEventListener('pointerup', stop);
  overlay.addEventListener('pointercancel', stop);

  previewResizeObserver = new ResizeObserver(() => updateLiveSubtitlePreview());
  previewResizeObserver.observe(frame);
}

function setLiveSubtitleYFromPointer(clientY) {
  const frame = $('previewFrame');
  if (!frame) return;
  const rect = frame.getBoundingClientRect();
  if (!rect.height) return;
  fxState.subtitleYPercent = clamp(((clientY - rect.top) / rect.height) * 100, 8, 90);
  if ($('subtitleYPercent')) $('subtitleYPercent').value = fxState.subtitleYPercent.toFixed(1);
  fxState.subtitlePosition = fxState.subtitleYPercent < 35 ? 'top' : fxState.subtitleYPercent < 65 ? 'center' : 'bottom';
  if ($('subtitlePosition')) $('subtitlePosition').value = fxState.subtitlePosition;
  updateLiveSubtitlePreview();
}

function installEffectsPanel() {
  if ($('effectsPanel')) return;
  const card = document.createElement('section');
  card.className = 'card effects-panel';
  card.id = 'effectsPanel';
  card.innerHTML = `
    <div class="card-head effects-head">
      <div><p class="eyebrow">VIDEO FX + SUB</p><h2>Hiệu ứng video & Sub chuyên nghiệp</h2><p class="muted">Hiệu ứng được render thật bằng FFmpeg trên Cloud.</p></div>
      <span class="pill" id="effectActiveBadge">AUTO FX</span>
    </div>

    <div class="effects-mode-row">
      <div class="segmented effect-mode-switch" id="effectModeSwitch">
        <button type="button" class="active" data-mode="auto">✨ Tự động chọn</button>
        <button type="button" data-mode="manual">🎛 Thủ công</button>
      </div>
      <label class="effect-intensity">Cường độ <strong id="effectIntensityValue">65%</strong><input id="effectIntensity" type="range" min="5" max="100" value="65" /></label>
    </div>

    <div class="effect-auto-box" id="effectAutoBox">
      <strong>Auto Effect</strong>
      <span>Hệ thống dùng lyrics + thời lượng clip để ưu tiên nhóm hiệu ứng phù hợp, không chọn ngẫu nhiên vô nghĩa.</span>
    </div>

    <div class="effect-grid" id="effectGrid" hidden></div>

    <div class="subtitle-section">
      <div class="subtitle-title-row">
        <div><p class="eyebrow">SUBTITLE FX</p><h3>Sub / Lyrics</h3></div>
        <label class="toggle-line subtitle-enable"><input id="proSubtitleEnabled" type="checkbox" /> Bật sub</label>
      </div>
      <div class="smart-sync-banner" id="smartSyncBanner">
        <strong>🧠 Smart Sync AI</strong>
        <span>Không cần nhập thời gian. AI nghe đúng đoạn nhạc đang render rồi đối chiếu với lời gốc.</span>
      </div>
      <div class="subtitle-settings" id="subtitleSettings">
        <label>Đồng bộ<select id="subtitleSyncMode"><option value="smart" selected>Smart Sync AI — khuyên dùng</option><option value="timed">Dùng timestamp có sẵn (LRC)</option><option value="basic">Căn đều timeline — legacy</option></select></label>
        <label id="subtitleModelLabel">AI model<select id="subtitleModel"><option value="small" selected>Chuẩn hơn — Small</option><option value="base">Nhanh hơn — Base</option></select></label>
        <label>Style<select id="subtitleStyle"></select></label>
        <label>Animation<select id="subtitleAnimation"><option value="fade">Fade</option><option value="pop">Pop</option><option value="slide_up">Slide Up</option><option value="pulse">Pulse</option><option value="none">Không animation</option></select></label>
        <label>Preset vị trí<select id="subtitlePosition"><option value="bottom">Dưới</option><option value="center">Giữa</option><option value="top">Trên</option></select></label>
        <label>Font size <input id="subtitleFontSize" type="number" min="24" max="140" step="1" value="68" /></label>
        <label>Vị trí Y (%) <input id="subtitleYPercent" type="number" min="8" max="90" step="0.5" value="78" /></label>
        <label>Safe width (%) <input id="subtitleSafeWidth" type="number" min="55" max="94" step="1" value="84" /></label>
      </div>
      <div class="subtitle-live-note"><strong>LIVE PREVIEW:</strong> bật Sub rồi kéo trực tiếp dòng chữ trên khung Preview. Font size, Y và safe width bên trên chính là thông số sẽ burn vào video.</div>
      <div class="subtitle-preview-wrap"><div class="subtitle-preview style-clean_pro" id="subtitlePreview">Chén đắng chưa vơi, màu mây đã nhòa</div></div>
    </div>
  `;

  const renderBar = document.querySelector('#view-render .render-bar');
  renderBar?.insertAdjacentElement('beforebegin', card);

  const grid = $('effectGrid');
  for (const [id, name, desc] of EFFECTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'effect-card';
    button.dataset.effect = id;
    button.innerHTML = `<span class="effect-thumb fx-sample fx-${id}"><i></i></span><strong>${name}</strong><small>${desc}</small>`;
    button.addEventListener('click', () => selectEffect(id));
    grid.append(button);
  }

  const styleSelect = $('subtitleStyle');
  for (const [id, label] of SUB_STYLES) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    styleSelect.append(option);
  }

  $('effectModeSwitch').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    fxState.mode = button.dataset.mode;
    $('effectModeSwitch').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === button));
    $('effectGrid').hidden = fxState.mode !== 'manual';
    $('effectAutoBox').hidden = fxState.mode !== 'auto';
    updateEffectPreview();
  }));

  $('effectIntensity').addEventListener('input', (event) => {
    fxState.intensity = Number(event.target.value) / 100;
    $('effectIntensityValue').textContent = `${event.target.value}%`;
  });

  $('proSubtitleEnabled').addEventListener('change', (event) => {
    fxState.subtitleEnabled = event.target.checked;
    const legacy = $('renderLyrics');
    if (legacy) legacy.checked = fxState.subtitleEnabled;
    updateSubtitlePreview();
  });
  $('subtitleSyncMode').addEventListener('change', (event) => {
    fxState.subtitleSyncMode = event.target.value;
    updateSyncUi();
  });
  $('subtitleModel').addEventListener('change', (event) => { fxState.subtitleModel = event.target.value; });
  $('subtitleStyle').addEventListener('change', (event) => { fxState.subtitleStyle = event.target.value; updateSubtitlePreview(); });
  $('subtitleAnimation').addEventListener('change', (event) => { fxState.subtitleAnimation = event.target.value; updateSubtitlePreview(); });
  $('subtitlePosition').addEventListener('change', (event) => {
    fxState.subtitlePosition = event.target.value;
    fxState.subtitleYPercent = { top: 20, center: 50, bottom: 78 }[fxState.subtitlePosition] || 78;
    $('subtitleYPercent').value = fxState.subtitleYPercent;
    updateSubtitlePreview();
  });
  $('subtitleFontSize').addEventListener('input', (event) => {
    fxState.subtitleFontSize = clamp(event.target.value, 24, 140);
    event.target.value = fxState.subtitleFontSize;
    updateSubtitlePreview();
  });
  $('subtitleYPercent').addEventListener('input', (event) => {
    fxState.subtitleYPercent = clamp(event.target.value, 8, 90);
    event.target.value = fxState.subtitleYPercent;
    updateSubtitlePreview();
  });
  $('subtitleSafeWidth').addEventListener('input', (event) => {
    fxState.subtitleSafeWidthPercent = clamp(event.target.value, 55, 94);
    event.target.value = fxState.subtitleSafeWidthPercent;
    updateSubtitlePreview();
  });
  $('lyricsText')?.addEventListener('input', updateSubtitlePreview);

  const legacy = $('renderLyrics');
  if (legacy) {
    fxState.subtitleEnabled = legacy.checked;
    $('proSubtitleEnabled').checked = legacy.checked;
    legacy.addEventListener('change', () => {
      fxState.subtitleEnabled = legacy.checked;
      $('proSubtitleEnabled').checked = legacy.checked;
      updateSubtitlePreview();
    });
    const oldLine = legacy.closest('.toggle-line');
    if (oldLine) oldLine.hidden = true;
  }

  ensureLiveSubtitlePreview();
  selectEffect(fxState.preset, false);
  updateEffectPreview();
  updateSyncUi();
  updateSubtitlePreview();
}

function selectEffect(id, notify = true) {
  if (!EFFECTS.some(([effectId]) => effectId === id)) return;
  fxState.preset = id;
  document.querySelectorAll('.effect-card').forEach((button) => button.classList.toggle('active', button.dataset.effect === id));
  updateEffectPreview();
  if (notify) toast(`Hiệu ứng: ${EFFECTS.find(([effectId]) => effectId === id)?.[1] || id}`);
}

function updateEffectPreview() {
  const frame = $('previewFrame');
  if (!frame) return;
  for (const [id] of EFFECTS) frame.classList.remove(`preview-fx-${id}`);
  const effect = fxState.mode === 'auto' ? 'dynamic_mix' : fxState.preset;
  frame.classList.add(`preview-fx-${effect}`);
  const label = fxState.mode === 'auto' ? 'AUTO FX' : (EFFECTS.find(([id]) => id === fxState.preset)?.[1] || fxState.preset);
  if ($('effectActiveBadge')) $('effectActiveBadge').textContent = label;
}

function updateSyncUi() {
  const smart = fxState.subtitleSyncMode === 'smart';
  if ($('subtitleModelLabel')) $('subtitleModelLabel').hidden = !smart;
  const banner = $('smartSyncBanner');
  if (!banner) return;
  if (smart) {
    banner.classList.remove('warn');
    banner.innerHTML = '<strong>🧠 Smart Sync AI</strong><span>AI nghe đúng đoạn nhạc đang render rồi đối chiếu với lời gốc. Không cần timestamp.</span>';
  } else if (fxState.subtitleSyncMode === 'timed') {
    banner.classList.remove('warn');
    banner.innerHTML = '<strong>⏱ Timestamp có sẵn</strong><span>Dùng các mốc [00:12.34] trong lời. Nếu không có timestamp, hệ thống sẽ không burn sub.</span>';
  } else {
    banner.classList.add('warn');
    banner.innerHTML = '<strong>⚠ Legacy timeline</strong><span>Chia lời theo thời lượng ước lượng. Chỉ dùng khi bạn chấp nhận độ chính xác thấp.</span>';
  }
}

function applySubtitleStyleClass(element) {
  if (!element) return;
  for (const [id] of SUB_STYLES) element.classList.remove(`style-${id}`);
  element.classList.add(`style-${fxState.subtitleStyle}`);
}

function updateLiveSubtitlePreview() {
  ensureLiveSubtitlePreview();
  const frame = $('previewFrame');
  const overlay = $('liveSubtitleOverlay');
  const safe = $('liveSubtitleSafeArea');
  if (!frame || !overlay || !safe) return;

  const sample = previewLyricText();
  const text = $('liveSubtitleText');
  if (text) text.textContent = sample;
  applySubtitleStyleClass(overlay);

  const shortSide = Math.max(1, Math.min(frame.clientWidth, frame.clientHeight));
  const cssFontSize = Math.max(8, fxState.subtitleFontSize * shortSide / 1080);
  overlay.style.fontSize = `${cssFontSize}px`;
  overlay.style.width = `${fxState.subtitleSafeWidthPercent}%`;
  overlay.style.left = '50%';
  overlay.style.top = `${fxState.subtitleYPercent}%`;
  overlay.style.opacity = fxState.subtitleEnabled ? '1' : '0';
  overlay.style.pointerEvents = fxState.subtitleEnabled ? 'auto' : 'none';

  safe.style.width = `${fxState.subtitleSafeWidthPercent}%`;
  safe.classList.toggle('show', fxState.subtitleEnabled);
  safe.classList.toggle('unsafe-y', fxState.subtitleYPercent < 12 || fxState.subtitleYPercent > 84);
}

function updateSubtitlePreview() {
  const preview = $('subtitlePreview');
  if (preview) {
    applySubtitleStyleClass(preview);
    preview.classList.toggle('disabled', !fxState.subtitleEnabled);
    preview.dataset.animation = fxState.subtitleAnimation;
    preview.textContent = previewLyricText();
  }
  updateLiveSubtitlePreview();
}

function patchFetchForEffects() {
  window.fetch = async function patchedEffectsFetch(input, init = {}) {
    const rawUrl = typeof input === 'string' ? input : input?.url || '';
    let pathname = rawUrl;
    try { pathname = new URL(rawUrl, window.location.origin).pathname; } catch (_) {}
    const method = String(init?.method || 'GET').toUpperCase();
    if (pathname === '/api/jobs' && method === 'POST') {
      try {
        const payload = JSON.parse(init.body || '{}');
        payload.visual_effect = {
          mode: fxState.mode,
          preset: fxState.mode === 'manual' ? fxState.preset : 'auto',
          intensity: fxState.intensity,
        };
        payload.subtitle = {
          enabled: fxState.subtitleEnabled,
          style: fxState.subtitleStyle,
          animation: fxState.subtitleAnimation,
          position: fxState.subtitlePosition,
          size: fxState.subtitleSize,
          max_lines: fxState.subtitleMaxLines,
          sync_mode: fxState.subtitleSyncMode,
          language: fxState.subtitleLanguage,
          model: fxState.subtitleModel,
          min_confidence: fxState.subtitleMinConfidence,
          font_size: fxState.subtitleFontSize,
          y_percent: fxState.subtitleYPercent,
          safe_width_percent: fxState.subtitleSafeWidthPercent,
        };
        payload.lyrics = payload.lyrics || {};
        payload.lyrics.render = fxState.subtitleEnabled;
        return previousFetch(input, { ...init, body: JSON.stringify(payload) });
      } catch (_) {}
    }
    return previousFetch(input, init);
  };
}

patchFetchForEffects();
installEffectsPanel();
window.NGSEffects = { getState: () => ({ ...fxState }) };
