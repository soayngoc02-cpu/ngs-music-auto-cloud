const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function formatAudioTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const secs = value - minutes * 60;
  return `${minutes}:${secs.toFixed(1).padStart(4, '0')}`;
}

export class AudioTrimmer {
  constructor(options = {}) {
    this.root = document.getElementById(options.rootId || 'audioTrimCard');
    this.canvas = document.getElementById(options.canvasId || 'waveformCanvas');
    this.stage = document.getElementById(options.stageId || 'waveformStage');
    this.selection = document.getElementById(options.selectionId || 'waveformSelection');
    this.startHandle = document.getElementById(options.startHandleId || 'trimStartHandle');
    this.endHandle = document.getElementById(options.endHandleId || 'trimEndHandle');
    this.startInput = document.getElementById(options.startInputId || 'trimStartInput');
    this.endInput = document.getElementById(options.endInputId || 'trimEndInput');
    this.startLabel = document.getElementById(options.startLabelId || 'trimStartLabel');
    this.endLabel = document.getElementById(options.endLabelId || 'trimEndLabel');
    this.durationLabel = document.getElementById(options.durationLabelId || 'trimDurationLabel');
    this.playButton = document.getElementById(options.playButtonId || 'trimPlayBtn');
    this.useButton = document.getElementById(options.useButtonId || 'trimUseBtn');
    this.cancelButton = document.getElementById(options.cancelButtonId || 'trimCancelBtn');
    this.audio = document.getElementById(options.audioId || 'trimAudioPlayer');
    this.status = document.getElementById(options.statusId || 'trimStatus');

    this.file = null;
    this.objectUrl = '';
    this.duration = 0;
    this.start = 0;
    this.end = 0;
    this.confirmed = false;
    this.peaks = [];
    this.animationFrame = 0;
    this.onChange = options.onChange || (() => {});
    this.onUse = options.onUse || (() => {});
    this.onCancel = options.onCancel || (() => {});

    this.bind();
  }

  bind() {
    this.startInput?.addEventListener('change', () => this.setStart(Number(this.startInput.value)));
    this.endInput?.addEventListener('change', () => this.setEnd(Number(this.endInput.value)));
    this.playButton?.addEventListener('click', () => this.togglePlayback());
    this.useButton?.addEventListener('click', () => this.confirm());
    this.cancelButton?.addEventListener('click', () => this.onCancel());
    this.audio?.addEventListener('pause', () => this.updatePlayButton());
    this.audio?.addEventListener('play', () => this.updatePlayButton());
    window.addEventListener('resize', () => this.draw());

    this.bindHandle(this.startHandle, 'start');
    this.bindHandle(this.endHandle, 'end');

    this.stage?.addEventListener('pointerdown', (event) => {
      if (!this.duration || event.target === this.startHandle || event.target === this.endHandle) return;
      const rect = this.stage.getBoundingClientRect();
      const value = clamp(((event.clientX - rect.left) / rect.width) * this.duration, 0, this.duration);
      if (Math.abs(value - this.start) <= Math.abs(value - this.end)) this.setStart(value);
      else this.setEnd(value);
    });
  }

  bindHandle(handle, type) {
    if (!handle) return;
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        if (!this.duration) return;
        const rect = this.stage.getBoundingClientRect();
        const value = clamp(((moveEvent.clientX - rect.left) / rect.width) * this.duration, 0, this.duration);
        if (type === 'start') this.setStart(value);
        else this.setEnd(value);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  async loadFile(file, preferredDuration = 30) {
    this.clear(false);
    this.file = file;
    this.objectUrl = URL.createObjectURL(file);
    this.audio.src = this.objectUrl;
    this.status.textContent = 'Đang đọc nhạc...';

    await new Promise((resolve, reject) => {
      const ready = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error('Không đọc được thời lượng file nhạc'));
      };
      const cleanup = () => {
        this.audio.removeEventListener('loadedmetadata', ready);
        this.audio.removeEventListener('error', failed);
      };
      this.audio.addEventListener('loadedmetadata', ready, { once: true });
      this.audio.addEventListener('error', failed, { once: true });
      this.audio.load();
    });

    this.duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    const initialDuration = Number(preferredDuration) > 0 ? Number(preferredDuration) : Math.min(30, this.duration);
    this.start = 0;
    this.end = clamp(initialDuration || this.duration, 0, this.duration);
    if (this.end <= this.start) this.end = this.duration;
    this.confirmed = false;
    this.syncUi();

    try {
      await this.decodeWaveform(file);
      this.status.textContent = `Đã đọc ${formatAudioTime(this.duration)} · kéo 2 tay nắm để chọn đoạn`;
    } catch (error) {
      this.peaks = [];
      this.status.textContent = `Có thể nghe và cắt tay · waveform không giải mã được trên trình duyệt này`;
      this.draw();
    }
  }

  async decodeWaveform(file) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio API unavailable');
    const context = new AudioContextClass();
    try {
      const buffer = await file.arrayBuffer();
      const decoded = await context.decodeAudioData(buffer.slice(0));
      const channels = [];
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        channels.push(decoded.getChannelData(channel));
      }
      const buckets = 900;
      const block = Math.max(1, Math.floor(decoded.length / buckets));
      const peaks = new Array(buckets).fill(0);
      for (let i = 0; i < buckets; i += 1) {
        const from = i * block;
        const to = Math.min(decoded.length, from + block);
        let peak = 0;
        for (let sample = from; sample < to; sample += Math.max(1, Math.floor(block / 40))) {
          let mixed = 0;
          for (const channel of channels) mixed += Math.abs(channel[sample] || 0);
          peak = Math.max(peak, mixed / channels.length);
        }
        peaks[i] = peak;
      }
      const max = Math.max(...peaks, 0.0001);
      this.peaks = peaks.map((value) => value / max);
      this.draw();
    } finally {
      context.close().catch(() => {});
    }
  }

  open() {
    if (!this.file) return false;
    this.root.hidden = false;
    requestAnimationFrame(() => this.draw());
    return true;
  }

  hide() {
    this.pause();
    this.root.hidden = true;
  }

  clear(hide = true) {
    this.pause();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.file = null;
    this.objectUrl = '';
    this.duration = 0;
    this.start = 0;
    this.end = 0;
    this.confirmed = false;
    this.peaks = [];
    if (this.audio) {
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    if (hide && this.root) this.root.hidden = true;
    this.syncUi();
    this.draw();
  }

  setStart(value) {
    if (!this.duration) return;
    const maxStart = Math.max(0, this.end - 0.5);
    this.start = clamp(Number(value) || 0, 0, maxStart);
    this.markChanged();
  }

  setEnd(value) {
    if (!this.duration) return;
    const minEnd = Math.min(this.duration, this.start + 0.5);
    this.end = clamp(Number(value) || 0, minEnd, this.duration);
    this.markChanged();
  }

  markChanged() {
    this.confirmed = false;
    this.pause();
    this.syncUi();
    this.onChange(this.getSelection());
  }

  confirm() {
    if (!this.file || this.end <= this.start) return;
    this.confirmed = true;
    this.syncUi();
    this.onUse(this.getSelection());
  }

  getSelection() {
    return {
      start: Number(this.start.toFixed(3)),
      end: Number(this.end.toFixed(3)),
      duration: Number(Math.max(0, this.end - this.start).toFixed(3)),
      confirmed: this.confirmed,
    };
  }

  syncUi() {
    const duration = this.getSelection().duration;
    if (this.startInput) {
      this.startInput.value = this.start.toFixed(1);
      this.startInput.max = this.duration.toFixed(1);
    }
    if (this.endInput) {
      this.endInput.value = this.end.toFixed(1);
      this.endInput.max = this.duration.toFixed(1);
    }
    if (this.startLabel) this.startLabel.textContent = formatAudioTime(this.start);
    if (this.endLabel) this.endLabel.textContent = formatAudioTime(this.end);
    if (this.durationLabel) this.durationLabel.textContent = `${duration.toFixed(1)} giây`;
    if (this.useButton) this.useButton.textContent = this.confirmed ? '✓ Đang dùng đoạn này' : 'Dùng đoạn này';
    if (this.useButton) this.useButton.classList.toggle('confirmed', this.confirmed);
    this.updatePositions();
    this.updatePlayButton();
    this.draw();
  }

  updatePositions() {
    if (!this.duration) return;
    const left = (this.start / this.duration) * 100;
    const right = (this.end / this.duration) * 100;
    if (this.selection) {
      this.selection.style.left = `${left}%`;
      this.selection.style.width = `${Math.max(0, right - left)}%`;
    }
    if (this.startHandle) this.startHandle.style.left = `${left}%`;
    if (this.endHandle) this.endHandle.style.left = `${right}%`;
  }

  async togglePlayback() {
    if (!this.file || !this.duration) return;
    if (!this.audio.paused) {
      this.pause();
      return;
    }
    if (this.audio.currentTime < this.start || this.audio.currentTime >= this.end - 0.05) {
      this.audio.currentTime = this.start;
    }
    try {
      await this.audio.play();
      this.monitorPlayback();
    } catch (_) {
      this.updatePlayButton();
    }
  }

  monitorPlayback() {
    cancelAnimationFrame(this.animationFrame);
    const tick = () => {
      if (this.audio.paused) return;
      if (this.audio.currentTime >= this.end) {
        this.pause();
        this.audio.currentTime = this.start;
        return;
      }
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  pause() {
    cancelAnimationFrame(this.animationFrame);
    if (this.audio && !this.audio.paused) this.audio.pause();
    this.updatePlayButton();
  }

  updatePlayButton() {
    if (!this.playButton || !this.audio) return;
    this.playButton.textContent = this.audio.paused ? '▶ Nghe đoạn chọn' : '❚❚ Tạm dừng';
  }

  draw() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, width, height);

    const middle = height / 2;
    const barWidth = Math.max(1, width / Math.max(this.peaks.length || 90, 90));
    const values = this.peaks.length ? this.peaks : new Array(90).fill(0).map((_, i) => 0.08 + (Math.sin(i * 0.8) + 1) * 0.035);
    const step = width / values.length;
    ctx.fillStyle = '#6577a7';
    for (let i = 0; i < values.length; i += 1) {
      const amplitude = Math.max(1, values[i] * height * 0.42);
      const x = i * step;
      ctx.fillRect(x, middle - amplitude, Math.max(1, barWidth * 0.72), amplitude * 2);
    }

    if (this.duration > 0) {
      const from = (this.start / this.duration) * width;
      const to = (this.end / this.duration) * width;
      ctx.save();
      ctx.beginPath();
      ctx.rect(from, 0, Math.max(0, to - from), height);
      ctx.clip();
      ctx.fillStyle = '#b39cff';
      for (let i = 0; i < values.length; i += 1) {
        const amplitude = Math.max(1, values[i] * height * 0.42);
        const x = i * step;
        ctx.fillRect(x, middle - amplitude, Math.max(1, barWidth * 0.72), amplitude * 2);
      }
      ctx.restore();
    }
  }
}
