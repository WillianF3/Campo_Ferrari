/* Menu responsivo isolado para as paginas internas. Nao altera reservas, API ou autenticacao. */
(() => {
  'use strict';
  const header = document.querySelector('[data-cf-unified-header]');
  if (!header) return;
  const toggle = header.querySelector('[data-cf-header-toggle]');
  const menu = header.querySelector('[data-cf-header-menu]');
  if (!toggle || !menu) return;
  const mobile = () => window.matchMedia('(max-width: 991px)').matches;
  function setOpen(value) {
    const open = Boolean(value && mobile());
    menu.classList.toggle('show', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar navegação' : 'Abrir navegação');
  }
  toggle.addEventListener('click', () => setOpen(!menu.classList.contains('show')));
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.classList.contains('show')) { setOpen(false); toggle.focus(); } });
  document.addEventListener('click', event => { if (menu.classList.contains('show') && !header.contains(event.target)) setOpen(false); });
  window.addEventListener('resize', () => { if (!mobile()) setOpen(false); });
  window.addEventListener('scroll', () => header.classList.toggle('is-scrolled', window.scrollY > 8), {passive:true});
})();
