/* Campo Ferrari V12.18 — Web Push do administrador. Não guarda páginas/dados em cache. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch (_) {}
  const isTest = data.tag === 'cf-test';
  const isOpen = String(data.body || '').includes('lista aberta');
  const title = isTest ? 'Campo Ferrari · Teste' : 'Campo Ferrari · Novo agendamento';
  const body = isTest ? 'As notificações neste celular estão funcionando.' :
    (isOpen ? 'Nova inscrição na lista aberta. Abra o painel.' : 'Nova solicitação aguardando aprovação. Abra o painel.');
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: '/assets/favicons/icon-192x192.png',
    badge: '/assets/favicons/favicon-96x96.png',
    tag: (typeof data.tag === 'string' && /^cf-[\w-]{1,80}$/.test(data.tag)) ? data.tag : 'cf-new-booking',
    renotify: true, data: { url: '/admin/' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({type:'window',includeUncontrolled:true});
    const admin = clientsList.find(client => new URL(client.url).pathname.startsWith('/admin/'));
    if (admin) { await admin.focus(); return; }
    await clients.openWindow('/admin/');
  })());
});
