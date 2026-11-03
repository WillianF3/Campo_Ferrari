import { siteConfig } from './config/site.js';
import { normalizeBRWhatsApp } from './services/WhatsAppBooking.js?v=20261027-pagamento-v11-10';

const el = id => document.getElementById(id);
const form = el('invite-form');
const message = el('invite-message');
const hashParams = new URLSearchParams(window.location.hash.slice(1));
const token = hashParams.get('token') || '';
const urlPlayer = hashParams.get('player') || '';
const urlEdit = hashParams.get('edit') || '';
const validToken = /^[a-f0-9]{64}$/i.test(token);
const apiBase = (siteConfig.apiBaseUrl || '').replace(/\/$/, '');
const formatDate = day => /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : String(day || 'A confirmar');
let invitation = null;
let sending = false;
let completed = false;
const editStorageKey = `cf_invite_edit_${token}`;
let editRecord = null;
let verifiedEdit = false;
const makeEditLink = record => `${window.location.origin}${window.location.pathname}#token=${token}&player=${encodeURIComponent(record.id)}&edit=${encodeURIComponent(record.edit_key)}`;
try {
  const stored = JSON.parse(window.localStorage.getItem(editStorageKey) || 'null');
  if (stored && /^cp_[a-f0-9]{16}$/.test(stored.id) && /^[a-f0-9]{64}$/.test(stored.edit_key)) editRecord = stored;
} catch { /* Armazenamento indisponível: a inscrição ainda funciona. */ }
// O link individual vem do jogador ou do administrador; cada chave só dá acesso a um cadastro.
if (/^cp_[a-f0-9]{16}$/.test(urlPlayer) && /^[a-f0-9]{64}$/.test(urlEdit)) {
  editRecord = { id: urlPlayer, edit_key: urlEdit, name: '', public_name_consent: false };
  // A chave será armazenada apenas após a API comprovar que pertence ao jogador.
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#token=${token}`);
}
function storeEditRecord(record) {
  editRecord = record;
  verifiedEdit = true;
  el('invite-copy-link').hidden = false;
  el('invite-copy-roster').hidden = false;
  el('invite-success-edit').hidden = false;
  try { window.localStorage.setItem(editStorageKey, JSON.stringify(record)); } catch { /* edição disponível até atualizar a página */ }
}
function renderRoster(people, editAvailable) {
  const section = el('invite-roster');
  const list = el('invite-roster-list');
  list.replaceChildren();
  section.hidden = false;
  const entries = Array.isArray(people) ? people : [];
  el('invite-roster-count').textContent = `${entries.length} confirmado${entries.length === 1 ? '' : 's'}`;
  if (!entries.length) {
    const item = document.createElement('li');
    item.className = 'invite-roster-empty';
    item.textContent = 'Ainda não há jogadores cadastrados.';
    list.append(item);
  }
  entries.forEach((person, idx) => {
    const item = document.createElement('li');
    item.className = 'invite-roster-person';
    const number = document.createElement('span');
    number.className = 'invite-roster-number';
    number.textContent = String(idx + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'invite-roster-name';
    name.textContent = typeof person.display_name === 'string' ? person.display_name : 'Jogador confirmado';
    item.append(number, name);
    const isOwner = editAvailable && verifiedEdit && editRecord && person.id === editRecord.id;
    if (isOwner) {
      item.classList.add('is-my-registration');
      // Um participante pode ver seu próprio nome sem publicá-lo para os demais.
      name.textContent = `${editRecord.name} (você)`;
    }
    if (invitation?.changes_open === true && isOwner) {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'invite-roster-edit';
      editButton.textContent = 'Editar meu nome';
      editButton.addEventListener('click', openOwnEdit);
      item.append(editButton);
    }
    list.append(item);
  });
  if (!verifiedEdit || !editAvailable || !invitation?.changes_open) el('invite-edit-form').hidden = true;
  el('invite-copy-link').hidden = !(verifiedEdit && editAvailable);
  el('invite-copy-roster').hidden = !(verifiedEdit && editAvailable);
  el('invite-success-edit').hidden = !(verifiedEdit && editAvailable && invitation?.changes_open);
}


// A edição independe de aprovação: apenas o próprio jogador, com a chave privada, pode salvar.
function openOwnEdit() {
  if (!verifiedEdit || !editRecord || !invitation?.edit_available) {
    el('invite-recover').hidden = false;
    el('invite-edit-link').focus();
    el('invite-recover').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  if (!invitation.changes_open) {
    el('invite-edit-hint').hidden = false;
    el('invite-edit-hint').textContent = 'O prazo para alterações desta partida terminou.';
    return;
  }
  el('invite-recover').hidden = true;
  el('invite-edit-hint').hidden = true;
  el('invite-edit-name').value = editRecord.name || '';
  el('invite-edit-public').checked = editRecord.public_name_consent === true;
  el('invite-edit-feedback').textContent = '';
  el('invite-edit-form').hidden = false;
  el('invite-edit-form').scrollIntoView({behavior:'smooth',block:'nearest'});
  el('invite-edit-name').focus();
}

// Cole um link individual recebido na confirmação: a API autentica o segredo ANTES de armazená-lo.
function parsePrivateEditLink(raw) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) throw new Error('Cole o link particular de edição recebido após o cadastro.');
  let url;
  try { url = new URL(trimmed, window.location.href); }
  catch { throw new Error('O link de edição informado é inválido.'); }
  if (url.origin !== window.location.origin || url.pathname !== window.location.pathname)
    throw new Error('Use o link de edição deste site, gerado na confirmação do seu cadastro.');
  const params = new URLSearchParams(url.hash.slice(1));
  const player = params.get('player') || '';
  const edit = params.get('edit') || '';
  if (params.get('token') !== token || !/^cp_[a-f0-9]{16}$/.test(player) || !/^[a-f0-9]{64}$/.test(edit))
    throw new Error('O link não pertence a este convite ou está incompleto.');
  return {id: player, edit_key: edit};
}

el('invite-open-edit').addEventListener('click', openOwnEdit);
el('invite-success-edit').addEventListener('click', openOwnEdit);
el('invite-recover-cancel').addEventListener('click', () => { el('invite-recover').hidden = true; });
el('invite-recover-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (sending) return;
  const feedback = el('invite-recover-feedback');
  sending = true;
  el('invite-recover-submit').disabled = true;
  feedback.textContent = 'Conferindo seu link individual…';
  try {
    const recovered = parsePrivateEditLink(el('invite-edit-link').value);
    const own = await request(`/participants/${encodeURIComponent(recovered.id)}/access`, {edit_key: recovered.edit_key});
    storeEditRecord({...recovered, name: own.name, public_name_consent: own.public_name_consent === true});
    el('invite-edit-link').value = '';
    feedback.textContent = '';
    renderRoster(invitation?.participants, true);
    openOwnEdit();
  } catch (error) { feedback.textContent = error.message; }
  finally { sending = false; el('invite-recover-submit').disabled = false; }
});

function setMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle('is-error', error);
  message.setAttribute('role', error ? 'alert' : 'status');
}

async function request(path, body) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${apiBase}/api/closed-invitations/${encodeURIComponent(token)}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    });
  } catch {
    throw new Error('Não foi possível conectar ao sistema. Confira sua internet e tente novamente.');
  } finally {
    window.clearTimeout(timeout);
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('O sistema de cadastros está indisponível. Tente novamente mais tarde.'); }
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Não foi possível concluir o cadastro. Tente novamente.');
  if (!data || typeof data !== 'object') throw new Error('O sistema retornou uma resposta incompleta. Tente novamente.');
  return data;
}

function renderInvitation(data) {
  invitation = data;
  const remaining = Math.max(0, Math.floor(Number(data.remaining_spots) || 0));
  const canRegister = data.status === 'approved' && data.registration_open === true && remaining > 0;
  el('invite-date').textContent = formatDate(data.date);
  el('invite-period').textContent = data.period_label || 'A confirmar';
  el('invite-spots').textContent = `${remaining} de ${Math.max(0, Number(data.player_count) || 0)}`;
  el('invite-summary').hidden = false;
  // Esta seção sempre aparece, inclusive quando todas as vagas foram preenchidas.
  renderRoster(data.participants, data.edit_available === true);
  el('invite-open-edit').hidden = data.edit_available !== true || data.changes_open !== true;
  el('invite-badge').textContent = canRegister ? 'LISTA APROVADA' : 'CADASTROS ENCERRADOS';
  form.hidden = !canRegister || completed;
  setMessage(canRegister ? 'Sua lista foi aprovada. Confirme seus dados para garantir uma das vagas do grupo.' : remaining === 0 ? 'Todas as vagas deste convite já foram preenchidas. Fale com o responsável pelo grupo.' : 'Este convite não está aceitando novos cadastros. Fale com o responsável pelo grupo.');
}

async function loadInvitation() {
  el('invite-retry').hidden = true;
  form.hidden = true;
  el('invite-summary').hidden = true;
  el('invite-roster').hidden = true;
  if (!validToken) {
    setMessage('Este link de convite está incompleto ou é inválido. Peça ao responsável pelo grupo o link gerado após a aprovação.', true);
    return;
  }
  setMessage('Consultando seu convite…');
  try {
    const data = await request('');
    renderInvitation(data);
    if (editRecord && data.edit_available) {
      try {
        const own = await request(`/participants/${encodeURIComponent(editRecord.id)}/access`, { edit_key: editRecord.edit_key });
        storeEditRecord({ ...editRecord, name: own.name, public_name_consent: own.public_name_consent === true });
        renderRoster(data.participants, true);
      } catch (error) { // Erros temporários não invalidam a chave armazenada.
        if (/inválid|autoriza|encontrad/i.test(error.message)) {
          editRecord = null;
          verifiedEdit = false;
          try { window.localStorage.removeItem(editStorageKey); } catch {}
        }
        renderRoster(data.participants, data.edit_available === true);
      }
    }
  } catch (error) {
    setMessage(error.message, true);
    el('invite-retry').hidden = false;
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || completed || !invitation || !form.reportValidity()) return;
  const name = form.elements.name.value.trim();
  const whatsapp = normalizeBRWhatsApp(form.elements.whatsapp.value);
  if (name.length < 2 || name.length > 120) {
    setMessage('Informe seu nome com 2 a 120 caracteres.', true);
    form.elements.name.focus();
    return;
  }
  if (!whatsapp) {
    setMessage('Confira seu WhatsApp com DDD. Exemplo: (49) 99999-9999.', true);
    form.elements.whatsapp.focus();
    return;
  }
  sending = true;
  el('invite-fields').disabled = true;
  el('invite-submit').textContent = 'Confirmando cadastro…';
  setMessage('Enviando seus dados…');
  try {
    const result = await request('/participants', { name, whatsapp, responsible_adult: form.elements.responsible_adult.checked, privacy_consent: form.elements.privacy_consent.checked, public_name_consent: form.elements.public_name_consent.checked });
    if (result.status !== 'registered' || !result.id) throw new Error('Não foi possível confirmar seu cadastro. Tente novamente.');
    if (result.edit_available === true && /^[a-f0-9]{64}$/.test(result.edit_key || '')) {
      storeEditRecord({ id: result.id, edit_key: result.edit_key, name, public_name_consent: form.elements.public_name_consent.checked });
    }
    completed = true;
    form.hidden = true;
    form.reset();
    el('invite-success-text').textContent = `Seu cadastro para ${formatDate(result.date || invitation.date)} · ${result.period_label || invitation.period_label || 'horário combinado com o grupo'} foi registrado.`;
    el('invite-success').hidden = false;
    el('invite-copy-link').hidden = !editRecord;
    // Consulta a lista novamente para exibir o nome confirmado sem recarregar a página.
    try { renderInvitation(await request('')); } catch { /* cadastro confirmado mesmo que atualização visual falhe */ }
    setMessage('Seu cadastro foi concluído com sucesso.');
    el('invite-success-title').setAttribute('tabindex', '-1');
    el('invite-success-title').focus();
  } catch (error) {
    setMessage(error.message, true);
    // O servidor verifica vagas e duplicidade novamente em cada envio.
  } finally {
    sending = false;
    el('invite-fields').disabled = false;
    el('invite-submit').innerHTML = 'Confirmar meu cadastro <span aria-hidden="true">↗</span>';
  }
});

el('invite-edit-cancel').addEventListener('click', () => {
  el('invite-edit-form').hidden = true;
  el('invite-edit-feedback').textContent = '';
});
el('invite-edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || !verifiedEdit || !editRecord || !invitation?.edit_available) return;
  const input = el('invite-edit-name');
  const name = input.value.trim();
  if (name.length < 2 || name.length > 120 || !input.reportValidity()) {
    el('invite-edit-feedback').textContent = 'Digite um nome de 2 a 120 caracteres.';
    input.focus();
    return;
  }
  sending = true;
  const save = el('invite-edit-save');
  save.disabled = true;
  el('invite-edit-feedback').textContent = 'Salvando alteração…';
  try {
    const visible = el('invite-edit-public').checked;
    const result = await request(`/participants/${encodeURIComponent(editRecord.id)}`, {
      edit_key: editRecord.edit_key,
      name,
      public_name_consent: visible
    });
    if (result.status !== 'updated') throw new Error('O sistema não confirmou a alteração.');
    storeEditRecord({ ...editRecord, name, public_name_consent: visible });
    el('invite-edit-form').hidden = true;
    const current = await request('');
    renderInvitation(current);
    setMessage('Seu cadastro foi atualizado. Nenhuma autorização do administrador é necessária.');
  } catch (error) {
    el('invite-edit-feedback').textContent = error.message;
  } finally {
    sending = false;
    save.disabled = false;
  }
});
el('invite-copy-link').addEventListener('click', async () => {
  if (!verifiedEdit || !editRecord) return;
  try {
    await navigator.clipboard.writeText(makeEditLink(editRecord));
    el('invite-link-feedback').textContent = 'Seu link particular foi copiado. Não compartilhe com outras pessoas.';
  } catch {
    el('invite-link-feedback').textContent = `Não foi possível copiar automaticamente. Seu link: ${makeEditLink(editRecord)}`;
  }
});
el('invite-copy-roster').addEventListener('click', async () => {
  if (!verifiedEdit || !editRecord) return;
  try {
    await navigator.clipboard.writeText(makeEditLink(editRecord));
    el('invite-edit-hint').hidden=false;
    el('invite-edit-hint').textContent='Link pessoal copiado. Envie apenas para seus próprios dispositivos.';
  } catch {
    el('invite-edit-hint').hidden=false;
    el('invite-edit-hint').textContent=`Copie seu link: ${makeEditLink(editRecord)}`;
  }
});
el('invite-retry').addEventListener('click', loadInvitation);
loadInvitation();
