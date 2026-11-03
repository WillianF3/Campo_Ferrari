/* V12.10: abre/fecha o vídeo dos equipamentos, sem tocar em reservas ou API. */
document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('cf-equipment-video-dialog');
  const video = document.getElementById('cf-equipment-video');
  const openers = document.querySelectorAll('[data-open-equipment-video]');
  let lastOpener = null;
  const closer = dialog?.querySelector('[data-close-equipment-video]');
  if (!dialog || !video || !openers.length || !closer) return;

  const closeVideo = () => {
    if (dialog.open) dialog.close();
  };
  openers.forEach(opener => {
    opener.addEventListener('click', () => {
      lastOpener = opener;
      if (typeof dialog.showModal !== 'function') {
        window.open('assets/videos/equipamentos-campo-ferrari.mp4', '_blank', 'noopener,noreferrer');
        return;
      }
      if (!dialog.open) dialog.showModal();
      const attempt = video.play();
      if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
    });
  });
  closer.addEventListener('click', closeVideo);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeVideo();
  });
  dialog.addEventListener('close', () => {
    video.pause();
    video.currentTime = 0;
    lastOpener?.focus({ preventScroll: true });
  });
});
