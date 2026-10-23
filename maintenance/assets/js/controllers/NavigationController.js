/** Menu móvel independente do JavaScript do CDN. */
export class NavigationController {
  init() {
    const toggle = document.querySelector('.navbar-toggler');
    const menu = document.querySelector('#menu');
    const setOpen = open => { menu.classList.toggle('show', open); toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? 'Fechar navegação' : 'Abrir navegação'); };
    toggle.addEventListener('click', () => setOpen(!menu.classList.contains('show')));
    menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', event => { if(event.key === 'Escape' && menu.classList.contains('show')) { setOpen(false); toggle.focus(); } });
    document.addEventListener('click', event => { if (!event.target.closest('.navbar')) setOpen(false); });
  }
}
