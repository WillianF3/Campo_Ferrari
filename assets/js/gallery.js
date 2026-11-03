/**
 * Carrossel autônomo — funciona mesmo se algum outro módulo da página falhar.
 * Não depende de Bootstrap, bibliotecas nem de import/export.
 * O autoplay continua após cliques/arrastes. Respeita movimento reduzido.
 */
(() => {
  'use strict';
  const SELECTOR = '#field-gallery';

  class FerrariCarousel {
    constructor(root) {
      this.root = root;
      this.slides = Array.from(root.querySelectorAll('.gallery-slide'));
      this.viewport = root.querySelector('.gallery-viewport');
      this.prev = root.querySelector('[data-prev]');
      this.next = root.querySelector('[data-next]');
      this.dots = Array.from(root.querySelectorAll('[data-gallery-dot]'));
      this.counter = root.querySelector('[data-gallery-counter]');
      this.announcement = root.querySelector('[data-announcement]');
      this.progress = root.querySelector('[data-gallery-progress]');
      this.duration = Math.max(2000, Number(root.dataset.autoplay) || 6000);
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.index = 0;
      this.timer = null;
      this.pointer = null;
    }

    init() {
      if (this.slides.length < 1 || !this.viewport || !this.prev || !this.next) return;
      this.root.style.setProperty('--gallery-duration', `${this.duration}ms`);
      this.prev.addEventListener('click', () => this.goTo(this.index - 1, true));
      this.next.addEventListener('click', () => this.goTo(this.index + 1, true));
      this.dots.forEach((dot, index) => dot.addEventListener('click', () => this.goTo(index, true)));

      this.root.addEventListener('keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,textarea,select')) return;
        let next = null;
        if (event.key === 'ArrowRight') next = this.index + 1;
        else if (event.key === 'ArrowLeft') next = this.index - 1;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = this.slides.length - 1;
        if (next === null) return;
        event.preventDefault();
        this.goTo(next, true);
      });

      this.viewport.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' || !event.isPrimary || event.target.closest('a,button')) return;
        this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      });
      this.viewport.addEventListener('pointerup', event => {
        if (!this.pointer || event.pointerId !== this.pointer.id) return;
        const dx = event.clientX - this.pointer.x;
        const dy = event.clientY - this.pointer.y;
        this.pointer = null;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          this.goTo(this.index + (dx < 0 ? 1 : -1), true);
        }
      });
      this.viewport.addEventListener('pointercancel', () => { this.pointer = null; });
      document.addEventListener('visibilitychange', () => this.schedule());
      if (this.reducedMotion.addEventListener) {
        this.reducedMotion.addEventListener('change', () => this.schedule());
      } else if (this.reducedMotion.addListener) {
        this.reducedMotion.addListener(() => this.schedule());
      }

      this.prev.disabled = this.slides.length < 2;
      this.next.disabled = this.slides.length < 2;
      this.render(false);
      this.schedule();
      this.root.dataset.initialized = 'true';
    }

    goTo(index, announce = false) {
      this.index = (index % this.slides.length + this.slides.length) % this.slides.length;
      this.render(announce);
      this.schedule();
    }

    render(announce) {
      this.slides.forEach((slide, i) => {
        const active = i === this.index;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', String(!active));
        slide.inert = !active;
      });
      this.dots.forEach((dot, i) => {
        const active = i === this.index;
        dot.setAttribute('aria-current', active ? 'true' : 'false');
        dot.setAttribute('aria-label', `Mostrar foto ${i + 1} de ${this.slides.length}`);
      });
      if (this.counter) this.counter.textContent = `${String(this.index + 1).padStart(2, '0')} / ${String(this.slides.length).padStart(2, '0')}`;
      if (this.announcement && announce) {
        this.announcement.textContent = `Foto ${this.index + 1} de ${this.slides.length}: ${this.slides[this.index].dataset.title || ''}`;
      }
    }

    schedule() {
      window.clearTimeout(this.timer);
      this.timer = null;
      const shouldPlay = this.slides.length > 1 && !document.hidden && !this.reducedMotion.matches;
      this.root.classList.toggle('is-autoplaying', shouldPlay);
      if (this.progress) {
        this.progress.classList.remove('is-running');
        // Força o reinício da animação a cada nova foto, sem cronômetro duplicado.
        if (shouldPlay) {
          void this.progress.offsetWidth;
          this.progress.classList.add('is-running');
        }
      }
      if (!shouldPlay) return;
      this.timer = window.setTimeout(() => this.goTo(this.index + 1), this.duration);
    }
  }

  const start = () => {
    const root = document.querySelector(SELECTOR);
    if (root && root.dataset.initialized !== 'true') new FerrariCarousel(root).init();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
