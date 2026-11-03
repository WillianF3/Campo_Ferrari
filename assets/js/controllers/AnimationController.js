/** Efeitos progressivos: o conteúdo permanece visível sem JavaScript. */
export class AnimationController {
  init() {
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    const items = document.querySelectorAll('.section-heading, .section h2, .field-art, .experience-card, .steps .col-md-4, .booking-panel, .contact-links, .gallery-shell');
    if ('IntersectionObserver' in window && !this.motion.matches) {
      this.observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('revealed'); this.observer.unobserve(entry.target); }
      }), {threshold: 0.08});
      items.forEach(item => { item.classList.add('reveal'); this.observer.observe(item); });
    }
    this.motion.addEventListener('change', () => {
      if (this.motion.matches) { items.forEach(item => item.classList.add('revealed')); this.observer?.disconnect(); }
    });
    const top = document.querySelector('.back-top');
    const progress = document.querySelector('.reading-progress');
    const update = () => {
      const range = document.documentElement.scrollHeight - innerHeight;
      progress.style.transform = `scaleX(${range > 0 ? scrollY / range : 0})`;
      top.hidden = scrollY < 500;
      document.querySelector('.site-header').classList.toggle('is-scrolled', scrollY > 30);
    };
    let queued = false;
    addEventListener('scroll', () => {
      if (!queued) { queued = true; requestAnimationFrame(() => { update(); queued = false; }); }
    }, {passive:true});
    addEventListener('resize', update);
    update();
  }
}
