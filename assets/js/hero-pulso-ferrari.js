/* Hero Campo Ferrari V12.4: microinterações e reprodução silenciosa de vídeo.
 * Independente do sistema de reservas; não modifica dados nem chama a API.
 */
document.addEventListener('DOMContentLoaded', () => {
  const title = document.querySelector('.cf-hero-mainword');
  const subtitle = document.querySelector('.cf-hero-script');
  const video = document.getElementById('cf-hero-video');

  [title, subtitle].filter(Boolean).forEach(element => {
    let thinTimer;
    element.addEventListener('touchstart', () => {
      element.classList.add('is-thin');
      clearTimeout(thinTimer);
      thinTimer = setTimeout(() => element.classList.remove('is-thin'), 630);
    }, { passive: true });
  });

  // Frases rotativas abaixo de "AIRSOFT". Para alterar as mensagens,
  // edite esta lista. O texto inicial permanece visível sem JavaScript.
  if (subtitle) {
    const phrases = [
      'ESTRATÉGIA.',
      'ADRENALINA.',
      'A SUA EQUIPE.',
      'DIVERSÃO.',
      'HONESTIDADE.',
      'TRABALHO EM EQUIPE.'
    ];
    let phraseIndex = 0;
    let isInView = true;
    const transitionMs = 420;
    const intervalMs = 4500;

    // Evita atualizar a frase fora da tela, na aba inativa ou durante leitura.
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        isInView = entries[0]?.isIntersecting ?? true;
      }, { threshold: 0.05 });
      observer.observe(subtitle);
    }

    window.setInterval(() => {
      if (document.hidden || !isInView || subtitle.matches(':hover, :focus')) return;

      // Em dispositivos que pedem menos movimento, troca sem transição.
      const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) {
        phraseIndex = (phraseIndex + 1) % phrases.length;
        subtitle.textContent = phrases[phraseIndex];
        return;
      }

      subtitle.classList.add('cf-hero-script--out');
      window.setTimeout(() => {
        phraseIndex = (phraseIndex + 1) % phrases.length;
        subtitle.textContent = phrases[phraseIndex];
        subtitle.classList.remove('cf-hero-script--out');
      }, transitionMs);
    }, intervalMs);
  }

  if (!video) return;
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  const replay = () => {
    video.muted = true;
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') return attempt;
    return Promise.resolve();
  };
  const retryOnInteraction = () => {
    replay().catch(() => {});
    window.removeEventListener('click', retryOnInteraction);
    window.removeEventListener('touchstart', retryOnInteraction);
  };
  replay().catch(() => {
    window.addEventListener('click', retryOnInteraction, { once: true });
    window.addEventListener('touchstart', retryOnInteraction, { once: true, passive: true });
  });
});
