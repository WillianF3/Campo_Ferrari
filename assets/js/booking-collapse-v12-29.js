/* V12.29 — Ao entrar em #agendar por qualquer botão, expanda a agenda.
   Não interfere na escolha de modalidade nem na lógica das reservas. */
(() => {
  'use strict';
  const details = document.getElementById('cf-booking-details');
  if (!details) return;
  const expandForBooking = () => { details.open = true; };
  // Executa antes dos listeners de modalidade (Lista Aberta e cards de experiências).
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href="#agendar"]');
    if (link) expandForBooking();
  }, { capture: true });
  if (window.location.hash === '#agendar') expandForBooking();
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#agendar') expandForBooking();
  });
})();
