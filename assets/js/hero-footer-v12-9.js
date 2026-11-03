// Campo Ferrari V12.9: transição opcional somente no rodapé do hero.
// O conteúdo permanece visível caso JavaScript ou IntersectionObserver não estejam disponíveis.
document.addEventListener('DOMContentLoaded', () => {
  const footer = document.querySelector('.hero-pulso-ferrari .cf-hero-bottom');
  if (!footer || !('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  footer.classList.add('cf-motion-pending');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.remove('cf-motion-pending');
      entry.target.classList.add('cf-motion-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.1 });
  observer.observe(footer);
});
