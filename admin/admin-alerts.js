/** V12.17 — avisos privados no painel. Consultas exigem sessão administrativa.
 * Polling funciona apenas enquanto o painel estiver aberto; não é push em segundo plano.
 * Apenas IDs marcados como lidos são armazenados no navegador, nunca contatos/dados privados.
 */
export function createAdminAlerts({ api, onOpen }) {
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const center = $('#admin-alert-center');
  const details = $('#admin-alert-details');
  const toggle = $('#admin-alert-toggle');
  const summary = $('#admin-alert-summary');
  const list = $('#admin-alerts-list');
  const badge = $('#admin-alerts-badge');
  const markAll = $('#admin-alerts-read-all');
  const browserButton = $('#admin-alerts-browser');
  const status = $('#admin-alerts-status');
  const toast = $('#admin-alert-toast');
  const POLL_MS = 12000;
  let timer = null, account = '', items = [], seen = new Set(), known = new Set();
  let initialized = false, busy = false, active = false, browserEnabled = false;
  let expanded = false, previousUnread = null;
  function setExpanded(value) {
    expanded = Boolean(value);
    details.hidden = !expanded;
    center.classList.toggle('is-collapsed', !expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = expanded ? 'Recolher avisos ▴' : 'Ver histórico ▾';
  }
  const key = () => `campo-ferrari-admin-alertas-v1:${account}`;
  function save() {
    try { localStorage.setItem(key(), JSON.stringify([...seen].slice(-500))); } catch (_) {}
  }
  function itemId(item) { return String(item.kind) + ':' + String(item.entity_id); }
  function displayDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return 'Data não informada';
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }
  function description(item) {
    const labels = {manha:'Manhã', tarde:'Tarde', noite:'Noite'};
    return `${displayDate(item.game_date)} · ${labels[item.period] || 'Turno a confirmar'} · ${Number(item.people_count)||0} participante(s)`;
  }
  function render() {
    const unread = items.filter(item => !seen.has(itemId(item))).length;
    badge.textContent = String(unread);
    badge.hidden = unread === 0;
    markAll.disabled = unread === 0;
    // Sem pendências: resume o painel. O usuário ainda pode consultar o histórico.
    // Pendências novas: abre automaticamente, sem reabrir a cada atualização periódica.
    if (unread > 0 && (previousUnread === null || unread > previousUnread || previousUnread === 0)) {
      setExpanded(true);
    } else if (unread === 0 && previousUnread !== null && previousUnread > 0) {
      setExpanded(false);
    }
    previousUnread = unread;
    summary.textContent = unread === 0 ? 'Nenhuma notificação pendente.' :
      `${unread} notificação${unread === 1 ? '' : 'ões'} pendente${unread === 1 ? '' : 's'} para conferir.`;
    status.textContent = unread ? `${unread} novo(s) registro(s) para conferir.` : 'Nenhuma notificação pendente.';
    list.innerHTML = items.length ? items.slice(0, 12).map(item => {
      const id = itemId(item), isNew = !seen.has(id);
      const type = item.kind === 'open' ? 'Nova inscrição · Lista aberta' : 'Solicitação · Lista fechada';
      return `<li class="admin-alert-item${isNew?' is-unread':''}"><button type="button" data-admin-alert="${escape(id)}" aria-label="Abrir ${escape(type)} de ${escape(item.customer_name)}"><span class="admin-alert-kind">${escape(type)}${isNew?' <strong>• NOVO</strong>':''}</span><span class="admin-alert-name">${escape(item.customer_name)}</span><span class="admin-alert-sub">${escape(description(item))}</span></button></li>`;
    }).join('') : '<li class="admin-alert-empty">Nenhum jogo ou inscrição recente.</li>';
  }
  function notify(item) {
    const type = item.kind === 'open' ? 'Nova inscrição na lista aberta' : 'Solicitação de lista fechada';
    toast.hidden = false;
    toast.querySelector('[data-alert-toast-title]').textContent = type;
    toast.querySelector('[data-alert-toast-message]').textContent = `${item.customer_name} · ${description(item)}`;
    toast.dataset.itemId = itemId(item);
    if (browserEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { const notification = new Notification('Campo Ferrari — ' + type, {body:`${item.customer_name} · ${description(item)}`, tag:'campo-ferrari-jogo'});
        notification.onclick = () => {window.focus(); open(itemId(item)); notification.close();};
      } catch (_) {}
    }
  }
  async function poll() {
    if (!active || busy) return;
    busy = true;
    try {
      const response = await api('/admin-alerts');
      if (!active) return;
      const fresh = Array.isArray(response.items) ? response.items : [];
      const nextIds = new Set(fresh.map(itemId));
      if (!initialized) {
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem(key())); } catch (_) {}
        if (Array.isArray(stored)) {
          seen = new Set(stored.filter(x => typeof x === 'string'));
        } else {
          // Primeiro acesso: registros anteriores não disparam avisos falsos.
          seen = new Set(nextIds);
          save();
        }
        initialized = true;
      }
      const arrivals = fresh.filter(item => !known.has(itemId(item)) && !seen.has(itemId(item)));
      const hadPreviousPoll = known.size > 0;
      items = fresh;
      known = nextIds;
      render();
      if (hadPreviousPoll && arrivals.length) notify(arrivals[0]);
    } catch (err) {
      if (active && err?.status === 401) stop();
      else if (active) {
        status.textContent = 'Não foi possível atualizar os avisos. Tentando novamente…';
        summary.textContent = 'Não foi possível atualizar os avisos. Tentando novamente…';
      }
    } finally {busy = false;}
  }
  function open(id) {
    const item = items.find(entry => itemId(entry) === id);
    if (!item) return;
    seen.add(id); save(); render(); toast.hidden = true;
    onOpen(item);
  }
  async function start(email) {
    stop();
    account = String(email ?? '').trim().toLowerCase();
    active = true;
    browserEnabled = false;
    status.textContent = 'Buscando novas reservas…';
    summary.textContent = 'Buscando novas reservas…';
    await poll();
    if (active) timer = setInterval(poll, POLL_MS);
  }
  function stop() {
    active = false;
    if (timer !== null) clearInterval(timer);
    timer = null;
    account = ''; items = []; seen = new Set(); known = new Set();
    initialized = false; busy = false; browserEnabled = false;
    toast.hidden = true;
    list.replaceChildren(); badge.hidden = true;
    previousUnread = null;
    summary.textContent = 'Buscando novas reservas…';
    setExpanded(false);
  }
  toggle.addEventListener('click', () => setExpanded(!expanded));
  list.addEventListener('click', event => {
    const button = event.target.closest('button[data-admin-alert]');
    if (button) open(button.dataset.adminAlert);
  });
  markAll.addEventListener('click', () => {
    items.forEach(item => seen.add(itemId(item)));
    save(); render(); toast.hidden = true;
  });
  $('#admin-alert-toast-open').addEventListener('click', () => open(toast.dataset.itemId));
  $('#admin-alert-toast-dismiss').addEventListener('click', () => {toast.hidden = true;});
  browserButton.addEventListener('click', async () => {
    if (typeof Notification === 'undefined' || !('requestPermission' in Notification)) {
      status.textContent = 'Este navegador não suporta avisos do sistema.';
      return;
    }
    const permission = await Notification.requestPermission();
    browserEnabled = permission === 'granted';
    browserButton.textContent = browserEnabled ? 'Avisos do navegador ativados ✓' : 'Ativar aviso no navegador';
    if (!browserEnabled) status.textContent = 'Permissão não concedida. Os avisos continuam aparecendo no painel.';
  });
  document.addEventListener('visibilitychange', () => {if (active && !document.hidden) poll();});
  return {start, stop, poll};
}
