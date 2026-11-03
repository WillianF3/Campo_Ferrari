/** V12.18 — Notificações do app instalado. Apenas administradores autenticados.
 * As permissões são pedidas após clique, nunca automaticamente.
 */
export function createMobilePush({api}) {
  const activate = document.getElementById('admin-push-enable');
  const disable = document.getElementById('admin-push-disable');
  const test = document.getElementById('admin-push-test');
  const status = document.getElementById('admin-push-status');
  let authenticated = false;
  const supported = () => window.isSecureContext && 'serviceWorker' in navigator &&
      'PushManager' in window && 'Notification' in window;
  const setStatus = text => { status.textContent = text; };
  const setActive = active => {
    activate.disabled = active;
    disable.disabled = !active;
    test.disabled = !active;
    activate.textContent = active ? 'Ativado neste aparelho ✓' : 'Ativar notificações neste celular';
  };
  function isIosBrowser() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }
  async function registration() {
    return navigator.serviceWorker.register('/sw.js', {scope:'/'});
  }
  function keyBytes(b64url) {
    const base = b64url.replace(/-/g,'+').replace(/_/g,'/');
    const raw = atob(base.padEnd(Math.ceil(base.length/4)*4,'='));
    return Uint8Array.from(raw, ch => ch.charCodeAt(0));
  }
  async function start() {
    authenticated = true;
    if (!supported()) {
      setStatus('Notificações push não são compatíveis com este navegador. Use HTTPS e um navegador atualizado.');
      activate.disabled = true;
      return;
    }
    if (isIosBrowser() && !isInstalled()) {
      setStatus('No iPhone, abra este painel pelo Safari e use Compartilhar → Adicionar à Tela de Início. Depois abra o ícone e ative aqui.');
      return;
    }
    try {
      const config = await api('/push/config');
      if (!authenticated) return;
      if (!config.ready) {
        setStatus('Antes de ativar, aplique a migração em Configurações → Manutenção do MySQL (após backup).');
        return;
      }
      const sw = await registration();
      let subscription = await sw.pushManager.getSubscription();
      // Se as chaves VAPID mudaram depois de restaurar o banco, solicitar nova ativação.
      if (subscription?.options?.applicationServerKey) {
        const existing = new Uint8Array(subscription.options.applicationServerKey);
        const expected = keyBytes(config.public_key);
        const same = existing.length === expected.length && existing.every((byte,i) => byte === expected[i]);
        if (!same) { await subscription.unsubscribe(); subscription = null; }
      }
      if (subscription && Notification.permission === 'granted') {
        // Restaurar a assinatura no servidor depois de migração ou reinício do painel.
        await api('/push/subscribe',{method:'POST',body:JSON.stringify(subscription.toJSON())});
      }
      if (!authenticated) return;
      setActive(!!subscription && Notification.permission === 'granted');
      setStatus(subscription && Notification.permission === 'granted' ?
        'Notificações ativadas neste aparelho. O celular poderá avisar mesmo com o painel fechado.' :
        'Toque em “Ativar notificações neste celular” e autorize os avisos. Para iPhone, instale primeiro o painel na Tela de Início.');
    } catch(err) { if(authenticated) setStatus(err?.message || 'Não foi possível verificar as notificações.'); }
  }
  activate.addEventListener('click', async () => {
    if (!authenticated || !supported()) return;
    if (isIosBrowser() && !isInstalled()) {
      setStatus('iPhone: no Safari, use Compartilhar → Adicionar à Tela de Início; depois abra o ícone do painel.');
      return;
    }
    // Requisição diretamente do clique: gesto exigido pelo iOS e outros navegadores.
    let permission;
    try { permission = await Notification.requestPermission(); }
    catch(_) {setStatus('Não foi possível pedir permissão de notificações neste navegador.');return;}
    if(permission !== 'granted') {setStatus('Permissão negada. Habilite notificações para o app nas configurações do aparelho.');return;}
    activate.disabled = true;
    setStatus('Registrando este aparelho para avisos de novas reservas…');
    try {
      const cfg = await api('/push/config');
      if(!cfg.ready) throw new Error('Aplique a atualização do MySQL em Configurações antes de ativar.');
      const sw = await registration();
      let subscription = await sw.pushManager.getSubscription();
      if(!subscription) subscription = await sw.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(cfg.public_key)});
      await api('/push/subscribe', {method:'POST', body:JSON.stringify(subscription.toJSON())});
      setActive(true);
      setStatus('Ativado! Agora use “Enviar teste para este celular”. Ao receber um novo jogo, o aviso chegará como notificação do sistema, quando o serviço de push estiver disponível.');
    } catch(err) {
      setActive(false);
      setStatus(err?.message || 'Não foi possível registrar o aparelho.');
    }
  });
  disable.addEventListener('click', async () => {
    if(!authenticated || !supported())return;
    disable.disabled = true;
    try {
      const sw = await registration();
      const subscription = await sw.pushManager.getSubscription();
      if(subscription) {
        await api('/push/unsubscribe',{method:'POST',body:JSON.stringify({endpoint:subscription.endpoint})});
        await subscription.unsubscribe();
      }
      setActive(false);
      setStatus('Notificações desativadas neste aparelho. Os avisos do painel continuam disponíveis.');
    } catch(err) {
      disable.disabled = false;
      setStatus(err?.message || 'Não foi possível desativar a inscrição.');
    }
  });
  test.addEventListener('click', async () => {
    if(!authenticated || !supported())return;
    test.disabled = true;
    try {
      const sw = await registration();
      const sub = await sw.pushManager.getSubscription();
      if(!sub)throw new Error('Ative as notificações primeiro.');
      await api('/push/test',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint})});
      setStatus('Teste enviado ao serviço de push. Confira se a notificação chegou na tela do celular.');
    } catch(err) {setStatus(err?.message || 'Não foi possível enviar o teste.');}
    finally { test.disabled = false; }
  });
  function stop() {authenticated=false;setActive(false);setStatus('Entre no painel para configurar este aparelho.');}
  return {start,stop};
}
