/**
 * Campo Ferrari V12.33 — carrossel contínuo acessível, com swipe nativo no celular.
 * No touchscreen, não interceptamos pointermove nem fazemos preventDefault:
 * o navegador controla o gesto e a inércia. A correção circular ocorre
 * SOMENTE depois que o scroll manual termina, evitando travadas e saltos.
 */
(() => {
  'use strict';

  const init = () => {
    const root = document.querySelector('#field-gallery.cf-gallery-marquee-shell');
    if (!root || root.dataset.initialized === 'true') return;
    const viewport = root.querySelector('.cf-marquee-window');
    const track = viewport?.querySelector('.cf-marquee-track');
    const original = track?.querySelector('.cf-marquee-group');
    if (!viewport || !track || !original || original.children.length < 2) return;

    // Dois grupos em cada lado deixam margem para a inércia do swipe nativo.
    const cloneGroup = () => {
      const clone = original.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      // Links nas cópias continuam clicáveis com toque/mouse, mas não duplicam o Tab.
      clone.querySelectorAll('a, button, [tabindex]').forEach(el => el.setAttribute('tabindex', '-1'));
      return clone;
    };
    track.insertBefore(cloneGroup(), original);
    track.insertBefore(cloneGroup(), original);
    track.appendChild(cloneGroup());
    track.appendChild(cloneGroup());
    root.dataset.initialized = 'true';
    root.classList.add('cf-marquee--ready');
    viewport.tabIndex = 0;
    viewport.setAttribute('aria-label', 'Galeria: deslize com o dedo, arraste com o mouse ou utilize as setas');

    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const baseGroups = 2;
    let groupWidth = 0;
    let mouseDrag = null;
    let suppressNextClick = false;
    let touchActive = false;
    let scrollingManually = false;
    let visible = true;
    let resumeAt = 0;
    let previousFrame = 0;
    let settleTimer = 0;

    const mod = (a, b) => ((a % b) + b) % b;
    const pauseFor = (ms = 1200) => { resumeAt = Math.max(resumeAt, performance.now() + ms); };
    const recenter = () => {
      if (!groupWidth || touchActive || scrollingManually) return;
      const center = groupWidth * baseGroups;
      const current = viewport.scrollLeft;
      if (current < center || current >= center + groupWidth) {
        viewport.scrollLeft = center + mod(current - center, groupWidth);
      }
    };
    const measure = () => {
      const width = original.getBoundingClientRect().width;
      if (!width || Math.abs(width - groupWidth) < 0.5) return;
      const old = groupWidth;
      const relative = old ? (viewport.scrollLeft - old * baseGroups) / old : 0;
      groupWidth = width;
      viewport.scrollLeft = width * (baseGroups + relative);
      recenter();
    };
    const settle = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        if (touchActive || mouseDrag) return;
        scrollingManually = false;
        recenter();
        pauseFor(900);
      }, 280);
    };

    // Touch: deixar o navegador tratar o gesto e o impulso (iOS/Android).
    // Nada de preventDefault() ou pointermove no touchscreen.
    viewport.addEventListener('touchstart', () => {
      touchActive = true;
      scrollingManually = true;
      window.clearTimeout(settleTimer);
      pauseFor(1500);
    }, { passive: true });
    const finishTouch = () => {
      touchActive = false;
      pauseFor(1300);
      settle(); // novos eventos de scroll adiam até a inércia acabar
    };
    viewport.addEventListener('touchend', finishTouch, { passive: true });
    viewport.addEventListener('touchcancel', finishTouch, { passive: true });
    viewport.addEventListener('scroll', () => {
      if (scrollingManually && !touchActive) settle();
    }, { passive: true });
    viewport.addEventListener('wheel', () => {
      scrollingManually = true;
      pauseFor(1200);
      settle();
    }, { passive: true });

    // Desktop: arraste real com mouse; nunca altera a lógica de toque nativa.
    viewport.addEventListener('pointerdown', event => {
      if ((event.pointerType !== 'mouse' && event.pointerType !== 'pen') || event.button !== 0) return;
      mouseDrag = { id: event.pointerId, startX: event.clientX, lastX: event.clientX, moved: false };
      pauseFor();
    });
    window.addEventListener('pointermove', event => {
      if (!mouseDrag || event.pointerId !== mouseDrag.id) return;
      if (!mouseDrag.moved) {
        if (Math.abs(event.clientX - mouseDrag.startX) < 7) return;
        mouseDrag.moved = true;
        viewport.classList.add('is-dragging');
        if (viewport.setPointerCapture) {
          try { viewport.setPointerCapture(event.pointerId); } catch { /* sem suporte */ }
        }
      }
      viewport.scrollLeft += mouseDrag.lastX - event.clientX;
      mouseDrag.lastX = event.clientX;
      recenter();
      pauseFor();
      if (event.cancelable) event.preventDefault();
    }, { passive: false });
    const stopMouse = event => {
      if (!mouseDrag || event.pointerId !== mouseDrag.id) return;
      if (mouseDrag.moved) {
        suppressNextClick = true;
        window.setTimeout(() => { suppressNextClick = false; }, 350);
      }
      viewport.classList.remove('is-dragging');
      mouseDrag = null;
      pauseFor();
      recenter();
    };
    window.addEventListener('pointerup', stopMouse);
    window.addEventListener('pointercancel', stopMouse);
    viewport.addEventListener('click', event => {
      if (!suppressNextClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressNextClick = false;
    }, true);
    viewport.addEventListener('dragstart', event => event.preventDefault());

    // Autoplay permanece ativo ao passar o mouse sobre os cartões.
    // Pausa somente durante interações manuais e quando a aba não está visível.

    const advance = direction => {
      scrollingManually = false;
      window.clearTimeout(settleTimer);
      const card = original.querySelector('.cf-marquee-card');
      const gap = parseFloat(getComputedStyle(original).gap) || 0;
      const distance = (card?.getBoundingClientRect().width || 280) + gap;
      viewport.scrollLeft += distance * direction;
      recenter();
      pauseFor(1200);
    };
    root.querySelectorAll('[data-marquee-direction]').forEach(button => {
      button.addEventListener('click', () => advance(Number(button.dataset.marqueeDirection)));
    });
    viewport.addEventListener('keydown', event => {
      if (event.target.closest('a, button')) return;
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      advance(event.key === 'ArrowRight' ? 1 : -1);
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => { visible = entries[0].isIntersecting; }, { threshold: .01 }).observe(root);
    }
    if ('ResizeObserver' in window) new ResizeObserver(measure).observe(original);
    else window.addEventListener('resize', measure, { passive: true });
    measure();

    // Autoplay contínuo, exceto durante interação manual ou redução de movimento.
    const tick = now => {
      if (previousFrame) {
        const dt = Math.min(64, now - previousFrame);
        const paused = reduceMotion.matches || !visible || document.hidden ||
          touchActive || scrollingManually || mouseDrag || now < resumeAt;
        if (!paused && groupWidth) {
          const seconds = parseFloat(getComputedStyle(root).getPropertyValue('--cf-marquee-speed')) || 40;
          viewport.scrollLeft += groupWidth * dt / (seconds * 1000);
          recenter();
        }
      }
      previousFrame = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
