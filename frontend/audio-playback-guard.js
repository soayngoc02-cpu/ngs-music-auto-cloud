let suppressCloudClickDispatch = false;

function cloudPreviewButtons() {
  return [...document.querySelectorAll('.cloud-play, #cloudSelectedPlay')];
}

// Cloud library preview uses a separate Audio() instance. Tell every AudioTrimmer
// to stop before the cloud preview starts so only one audio source can play.
document.addEventListener('click', (event) => {
  const button = event.target.closest?.('.cloud-play, #cloudSelectedPlay');
  if (!button || suppressCloudClickDispatch) return;
  window.dispatchEvent(new CustomEvent('ngs:audio-exclusive-play', {
    detail: { owner: 'cloud-library-preview' },
  }));
}, true);

// When a trimmer starts, stop any active cloud preview through its own button so
// music-picker.js keeps its internal preview state/button label synchronized.
window.addEventListener('ngs:audio-exclusive-play', (event) => {
  if (event.detail?.owner === 'cloud-library-preview') return;
  const active = cloudPreviewButtons().find((button) => /Dừng/i.test(button.textContent || ''));
  if (!active) return;
  suppressCloudClickDispatch = true;
  try {
    active.click();
  } finally {
    suppressCloudClickDispatch = false;
  }
});
