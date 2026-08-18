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
};

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
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
      <span>Hệ thống tự chọn một hiệu ứng phù hợp từ nhóm chuyển động + cinematic. Cùng một render ID luôn ra cùng lựa chọn, không random loạn.</span>
    </div>

    <div class="effect-grid" id="effectGrid" hidden></div>

    <div class="subtitle-section">
      <div class="subtitle-title-row">
        <div><p class="eyebrow">SUBTITLE FX</p><h3>Sub / Lyrics</h3></div>
        <label class="toggle-line subtitle-enable"><input id="proSubtitleEnabled" type="checkbox" /> Bật sub</label>
      </div>
      <p class="muted subtitle-note">Nếu lời chưa có timestamp, hệ thống căn line theo tỷ lệ timeline bài hát. Đây chưa phải karaoke word-sync chính xác.</p>
      <div class="subtitle-settings" id="subtitleSettings">
        <label>Style<select id="subtitleStyle"></select></label>
        <label>Animation<select id="subtitleAnimation"><option value="fade">Fade</option><option value="pop">Pop</option><option value="slide_up">Slide Up</option><option value="pulse">Pulse</option><option value="none">Không animation</option></select></label>
        <label>Vị trí<select id="subtitlePosition"><option value="bottom">Dưới</option><option value="center">Giữa</option><option value="top">Trên</option></select></label>
        <label>Kích thước<select id="subtitleSize"><option value="medium">M</option><option value="large" selected>L</option><option value="xlarge">XL</option></select></label>
      </div>
      <div class="subtitle-preview-wrap"><div class="subtitle-preview style-clean_pro" id="subtitlePreview">Ngày tháng ấy, mình từng thương nhau...</div></div>
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
  $('subtitleStyle').addEventListener('change', (event) => { fxState.subtitleStyle = event.target.value; updateSubtitlePreview(); });
  $('subtitleAnimation').addEventListener('change', (event) => { fxState.subtitleAnimation = event.target.value; updateSubtitlePreview(); });
  $('subtitlePosition').addEventListener('change', (event) => { fxState.subtitlePosition = event.target.value; updateSubtitlePreview(); });
  $('subtitleSize').addEventListener('change', (event) => { fxState.subtitleSize = event.target.value; updateSubtitlePreview(); });

  const legacy = $('renderLyrics');
  if (legacy) {
    fxState.subtitleEnabled = legacy.checked;
    $('proSubtitleEnabled').checked = legacy.checked;
    legacy.addEventListener('change', () => { fxState.subtitleEnabled = legacy.checked; $('proSubtitleEnabled').checked = legacy.checked; updateSubtitlePreview(); });
    const oldLine = legacy.closest('.toggle-line');
    if (oldLine) oldLine.hidden = true;
  }

  selectEffect(fxState.preset, false);
  updateEffectPreview();
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

function updateSubtitlePreview() {
  const preview = $('subtitlePreview');
  if (!preview) return;
  for (const [id] of SUB_STYLES) preview.classList.remove(`style-${id}`);
  preview.classList.add(`style-${fxState.subtitleStyle}`);
  preview.classList.toggle('disabled', !fxState.subtitleEnabled);
  preview.dataset.animation = fxState.subtitleAnimation;
  preview.dataset.position = fxState.subtitlePosition;
  preview.dataset.size = fxState.subtitleSize;
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
