import { whatsAppHref } from '../assets/js/services/WhatsAppBooking.js?v=20261027-pagamento-v11-10';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[character]));

export const approvalStatus = reservation => reservation.approval_status || 'approved';

/** Invitation secrets belong only in the private panel and the invitation URL fragment. */
export function invitationUrl(reservation) {
  if (approvalStatus(reservation) !== 'approved' || reservation.status === 'cancelled') return '';
  const path = String(reservation.invitation_path || '');
  if (!/^\/convite\.html#token=[a-f0-9]{64}$/.test(path)) return '';
  return new URL(path, location.origin).href;
}

export function renderApprovalControls(reservation) {
  const state = approvalStatus(reservation);
  const id = escape(reservation.id);
  const labels = {pending:'Aguardando aprovação', approved:'Aprovada', rejected:'Não aprovada'};
  const reason = reservation.approval_reason
    ? `<p class="reservation-approval-reason">${escape(reservation.approval_reason)}</p>` : '';
  const actions = state === 'pending'
    ? `<div class="reservation-approval-actions"><button type="button" class="primary" data-res-decision="approve" data-res-id="${id}">Aprovar e gerar link</button><button type="button" class="danger" data-res-decision="reject" data-res-id="${id}">Não aprovar</button></div><small>A aprovação verifica a disponibilidade do turno e dos equipamentos.</small>` : '';
  const url = invitationUrl(reservation);
  const issue = reservation.invitation_issue || 'none';
  const canGenerate = state === 'approved' && ['missing_approval','missing_token'].includes(issue);
  const total = Number(reservation.registered_people) || 0;
  const capacity = Number(reservation.player_count) || 0;
  const shareMessage = `Olá! Sua solicitação de ${reservation.request_kind==='evento_fechado'?'evento fechado':'lista fechada'} no Campo Ferrari foi aprovada. Compartilhe este link com os jogadores para cada pessoa fazer seu cadastro:\n${url}`;
  const shareHref = url ? whatsAppHref(reservation.customer_whatsapp, shareMessage) : '';
  const invitation = url
    ? `<div class="reservation-invitation"><label>Link para cadastro dos jogadores<input readonly data-invitation-input="${id}" value="${escape(url)}" aria-label="Link de cadastro da lista fechada ${id}"></label><div class="reservation-approval-actions"><button type="button" data-invitation-copy="${id}">Copiar link</button>${shareHref ? `<a class="reservation-share-link" href="${escape(shareHref)}" target="_blank" rel="noopener noreferrer">Enviar ao responsável ↗</a>` : ''}</div><small>${total} de ${capacity} jogador(es) cadastrado(s) pelo link.</small></div>`
    : canGenerate
      ? `<div class="reservation-approval-actions"><button type="button" class="primary" data-invitation-generate="${id}">Gerar link de cadastro</button></div><small>Reserva já aprovada, porém sem convite. Gere o link para compartilhá-lo com a equipe.</small>`
      : state === 'approved'
        ? `<small>${issue === 'closed' ? 'O cadastro está encerrado: a data/turno já passou ou a reserva foi cancelada.' : issue === 'schema_missing' ? 'O banco precisa da atualização em Configurações > Manutenção do MySQL para liberar convites.' : issue === 'legacy_pending' ? 'Esta reserva antiga está pendente. Confirme a situação antes de gerar um convite.' : 'Link de cadastro indisponível. Atualize o painel para verificar novamente.'}</small>`
        : '<small>O link de cadastro será liberado somente após a aprovação.</small>';
  return `<div class="reservation-approval">${reservation.request_kind==='evento_fechado'?'<strong>Evento fechado · valores e equipamentos a combinar</strong>':''}<span class="reservation-approval-badge is-${escape(state)}">${escape(labels[state] || state)}</span>${reason}${actions}${invitation}<p class="reservation-approval-feedback" data-approval-feedback="${id}" role="status" aria-live="polite"></p></div>`;
}

export async function copyInvitation(input) {
  const value=typeof input==='string'?input:String(input?.value||'');
  if(!value)throw new Error('O link de cadastro não está disponível.');
  if(navigator.clipboard?.writeText){
    try{await navigator.clipboard.writeText(value);return;}catch(_){}
  }
  // Compatível com navegadores sem Clipboard API (HTTPS é preferível).
  const temporary=document.createElement('textarea');
  temporary.value=value;temporary.readOnly=true;temporary.style.position='fixed';
  temporary.style.top='-9999px';temporary.style.opacity='0';
  document.body.appendChild(temporary);
  temporary.focus();temporary.select();
  let success=false;
  try{success=document.execCommand('copy');}finally{temporary.remove();}
  if(!success)throw new Error('Não foi possível copiar automaticamente. Abra os detalhes para selecionar o link.');
}

/** Shared by the table and the private reservation detail. All mutations use the caller's CSRF API. */
export function bindApprovalControls(container, {api, refresh, onError}) {
  container.addEventListener('click', async event => {
    const copyButton = event.target.closest('[data-invitation-copy]');
    if (copyButton) {
      const controls = copyButton.closest('.reservation-approval');
      const feedback = controls.querySelector('[data-approval-feedback]');
      try { await copyInvitation(controls.querySelector('[data-invitation-input]'));feedback.textContent='Link copiado. Compartilhe com os jogadores.'; }
      catch (error) { feedback.textContent=error.message; }
      return;
    }
    const createButton = event.target.closest('[data-invitation-generate]');
    const decisionButton = event.target.closest('[data-res-decision]');
    const button = createButton || decisionButton;
    if (!button || button.disabled) return;
    const controls = button.closest('.reservation-approval');
    const feedback = controls.querySelector('[data-approval-feedback]');
    const buttons = [...controls.querySelectorAll('button')];
    buttons.forEach(item => item.disabled=true);
    feedback.textContent=createButton ? 'Gerando convite seguro para esta reserva…'
      : decisionButton.dataset.resDecision === 'approve' ? 'Verificando a disponibilidade e gerando o link…' : 'Registrando a decisão…';
    try {
      if(createButton){
        await api(`/reservations/${encodeURIComponent(createButton.dataset.invitationGenerate)}/invitation`, {method:'POST'});
        await refresh('invitation');
      } else {
        await api(`/reservations/${encodeURIComponent(decisionButton.dataset.resId)}/approval`, {
          method:'PATCH', body:JSON.stringify({decision:decisionButton.dataset.resDecision})
        });
        await refresh(decisionButton.dataset.resDecision);
      }
    } catch (error) {
      feedback.textContent=error.message;
      onError?.(error);
      buttons.forEach(item => item.disabled=false);
    }
  });
}
