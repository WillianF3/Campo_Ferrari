/** Campo Ferrari V12.23 — somente recorte visual da faixa italiana direita. */
(() => {
  const init = () => {
    const hero = document.querySelector('.hero.hero-cinematic.hero-pulso-ferrari');
    const stripeWindow = hero?.querySelector('.cf-italian-stripe-window');
    const divider = hero?.querySelector('.cf-hero-bottom');
    const frame = hero?.querySelector('.cf-hero-frame');
    if (!hero || !stripeWindow || !divider || !frame) return;

    // Mantém o fim do fundo sobre a linha divisória, mesmo ao redimensionar.
    const alignToDivider = () => {
      // offsetTop ignora o translateY temporário da animação do rodapé.
      const height = Math.max(0, Math.min(hero.offsetHeight, frame.offsetTop + divider.offsetTop));
      stripeWindow.style.height = `${height.toFixed(1)}px`;
    };
    alignToDivider();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(alignToDivider);
      observer.observe(hero);
      observer.observe(frame);
      observer.observe(divider);
    }
    window.addEventListener('resize', alignToDivider, { passive: true });
    window.addEventListener('load', alignToDivider, { once: true });
    document.fonts?.ready.then(alignToDivider);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
