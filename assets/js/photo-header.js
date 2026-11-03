/** Menu responsivo da galeria. Reutiliza o cabeçalho da página principal,
 * sem adicionar dependências JS ao agendamento ou ao painel administrativo. */
(() => {
  'use strict';
  const header = document.querySelector('.cf-photos-page .site-header.cf-site-header');
  const toggle = header?.querySelector('.navbar-toggler');
  const menu = header?.querySelector('#menu');
  if (!header || !toggle || !menu) return;

  const isMobile = () => window.matchMedia('(max-width: 991px)').matches;
  const setOpen = (open) => {
    menu.classList.toggle('show', open && isMobile());
    toggle.setAttribute('aria-expanded', String(open && isMobile()));
    toggle.setAttribute('aria-label', open && isMobile() ? 'Fechar navegação' : 'Abrir navegação');
  };

  toggle.addEventListener('click', () => setOpen(!menu.classList.contains('show')));
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.classList.contains('show')) {
      setOpen(false);
      toggle.focus();
    }
  });
  document.addEventListener('click', event => {
    if (menu.classList.contains('show') && !header.contains(event.target)) setOpen(false);
  });
  window.addEventListener('resize', () => { if (!isMobile()) setOpen(false); });
  window.addEventListener('scroll', () => header.classList.toggle('is-scrolled', window.scrollY > 8), {passive: true});
})();
