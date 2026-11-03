/**
 * Campo Ferrari — carrossel independente das fotos em destaque.
 * Não interrompe a troca automática ao passar o mouse, tocar ou focar nos controles.
 * Respeita usuários que pediram movimento reduzido.
 */
(() => {
  'use strict';

  class HeroGallery {
    constructor(root) {
      this.root = root;
      this.items = Array.from(root.querySelectorAll('[data-hero-item]')).map(el => ({
        src: el.dataset.src,
        alt: el.dataset.alt || '',
        mainCaption: el.dataset.mainCaption || '',
        previewCaption: el.dataset.previewCaption || ''
      }));
      this.main = root.querySelector('[data-hero-main-img]');
      this.preview = root.querySelector('[data-hero-preview-img]');
      this.mainCaption = root.querySelector('[data-hero-main-caption]');
      this.previewCaption = root.querySelector('[data-hero-preview-caption]');
      this.prev = root.querySelector('[data-hero-prev]');
      this.next = root.querySelector('[data-hero-next]');
      this.dots = Array.from(root.querySelectorAll('[data-hero-dot]'));
      this.duration = Math.max(2000, Number(root.dataset.autoplay) || 6000);
      this.reducedMotion = typeof matchMedia === 'function'
        ? matchMedia('(prefers-reduced-motion: reduce)')
        : { matches: false };
      this.index = 0;
      this.timer = null;
      this.startX = null;
    }

    init() {
      if (this.items.length < 2 || !this.main || !this.preview || this.root.dataset.heroInitialized === 'true') return;
      this.root.dataset.heroInitialized = 'true';

      // Pré-carrega as quatro fotos para que a troca não dependa do tempo de download.
      this.items.forEach(item => {
        const preload = new Image();
        preload.src = item.src;
      });

      this.prev?.addEventListener('click', () => this.goTo(this.index - 1));
      this.next?.addEventListener('click', () => this.goTo(this.index + 1));
      this.dots.forEach((dot, index) => dot.addEventListener('click', () => this.goTo(index)));

      // Permite deslizar no celular sem bloquear a rolagem vertical.
      this.root.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse') return;
        this.startX = event.clientX;
      }, { passive: true });
      this.root.addEventListener('pointerup', event => {
        if (this.startX === null) return;
        const distance = event.clientX - this.startX;
        this.startX = null;
        if (Math.abs(distance) >= 45) this.goTo(this.index + (distance < 0 ? 1 : -1));
      }, { passive: true });
      this.root.addEventListener('pointercancel', () => { this.startX = null; }, { passive: true });

      // Controle pelo teclado sem atrapalhar links ou outros componentes.
      this.root.addEventListener('keydown', event => {
        if (event.target.matches('input, textarea, select')) return;
        if (event.key === 'ArrowRight') { event.preventDefault(); this.goTo(this.index + 1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); this.goTo(this.index - 1); }
      });
      document.addEventListener('visibilitychange', () => this.restart());
      if (typeof this.reducedMotion.addEventListener === 'function') {
        this.reducedMotion.addEventListener('change', () => this.restart());
      }

      this.render();
      this.restart();
    }

    render() {
      const current = this.items[this.index];
      const following = this.items[(this.index + 1) % this.items.length];
      this.main.src = current.src;
      this.main.alt = current.alt;
      this.preview.src = following.src;
      this.preview.alt = following.alt;
      if (this.mainCaption) this.mainCaption.textContent = current.mainCaption;
      if (this.previewCaption) this.previewCaption.textContent = following.previewCaption;
      this.dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === this.index)));
    }

    goTo(index) {
      this.index = (index % this.items.length + this.items.length) % this.items.length;
      this.render();
      this.restart();
    }

    restart() {
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = null;
      // O movimento reduzido e as abas ocultas pausam o autoplay por acessibilidade/desempenho.
      if (document.hidden || this.reducedMotion.matches) return;
      this.timer = window.setTimeout(() => this.goTo(this.index + 1), this.duration);
    }
  }

  function init() {
    document.querySelectorAll('[data-hero-gallery]').forEach(el => new HeroGallery(el).init());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
