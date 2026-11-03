/** Campo Ferrari — gentle tilts for feature cards; holographic gold effect for hero photos. */
(() => {
  'use strict';
  const init = () => {
    if (typeof matchMedia !== 'function') return;
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches ||
        matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const surfaces = document.querySelectorAll('.experience-card, .field-art');
    surfaces.forEach(surface => {
      let frame = 0;
      let x = 0, y = 0;
      const apply = () => {
        frame = 0;
        const rect = surface.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const px = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
        const py = Math.max(0, Math.min(1, (y - rect.top) / rect.height));
        const range = 4;
        surface.style.setProperty('--tilt-x', `${((0.5 - py) * range * 2).toFixed(2)}deg`);
        surface.style.setProperty('--tilt-y', `${((px - 0.5) * range * 2).toFixed(2)}deg`);
        surface.style.setProperty('--pointer-x', `${(px * 100).toFixed(1)}%`);
        surface.style.setProperty('--pointer-y', `${(py * 100).toFixed(1)}%`);
      };
      surface.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse') return;
        x = event.clientX;
        y = event.clientY;
        if (!frame) frame = requestAnimationFrame(apply);
      }, { passive: true });
      surface.addEventListener('pointerleave', () => {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        surface.style.setProperty('--tilt-x', '0deg');
        surface.style.setProperty('--tilt-y', '0deg');
        surface.style.setProperty('--pointer-x', '50%');
        surface.style.setProperty('--pointer-y', '50%');
      });
    });

    // Independent pointer tracking for the two hero photos. No changes to carousel logic.
    document.querySelectorAll('[data-holo-card]').forEach(card => {
      let frame = 0;
      let x = 0, y = 0;
      const apply = () => {
        frame = 0;
        const bounds = card.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const px = Math.max(0, Math.min(1, (x - bounds.left) / bounds.width));
        const py = Math.max(0, Math.min(1, (y - bounds.top) / bounds.height));
        const rx = (px - .5) * 2;
        const ry = (py - .5) * 2;
        card.style.setProperty('--holo-x', `${(px * 100).toFixed(1)}%`);
        card.style.setProperty('--holo-y', `${(py * 100).toFixed(1)}%`);
        card.style.setProperty('--holo-rotate-x', `${(-ry * 10).toFixed(2)}deg`);
        card.style.setProperty('--holo-rotate-y', `${(rx * 10).toFixed(2)}deg`);
      };
      const reset = () => {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        card.classList.remove('is-holo-active');
        card.style.setProperty('--holo-x', '50%');
        card.style.setProperty('--holo-y', '50%');
        card.style.setProperty('--holo-rotate-x', '0deg');
        card.style.setProperty('--holo-rotate-y', '0deg');
      };
      card.addEventListener('pointerenter', event => {
        if (event.pointerType !== 'mouse') return;
        card.classList.add('is-holo-active');
        x = event.clientX;
        y = event.clientY;
        if (!frame) frame = requestAnimationFrame(apply);
      }, { passive: true });
      card.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse') return;
        x = event.clientX;
        y = event.clientY;
        card.classList.add('is-holo-active');
        if (!frame) frame = requestAnimationFrame(apply);
      }, { passive: true });
      card.addEventListener('pointerleave', reset, { passive: true });
      card.addEventListener('pointercancel', reset, { passive: true });
      window.addEventListener('blur', reset, { passive: true });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
