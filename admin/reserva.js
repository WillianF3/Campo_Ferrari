/** Página privada: apenas dados de uma reserva, carregados da API com sessão administrativa. */
import { renderApprovalControls, bindApprovalControls } from './closed-list-approval.js?v=20261031-convite-fix';
const $ = selector => document.querySelector(selector);
let csrfToken = '';
const api = async (path, options={}) => {
  const response = await fetch('../api/admin'+path, {
    credentials:'same-origin', ...options,
    headers:{Accept:'application/json', ...(options.body?{'Content-Type':'application/json'}:{}),
      ...(options.method && options.method!=='GET'?{'X-CSRF-Token':csrfToken}:{})},cache:'no-store'
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(response.status===401?'Sua sessão expirou. Faça login para consultar esta reserva.':(result.detail||'Não foi possível concluir a solicitação.'));error.status=response.status;throw error;}
  return result;
};
const statuses = {
  pending:'Pendente',awaiting_payment:'Aguardando pagamento',
  payment_sent:'Comprovante enviado',confirmed:'Confirmada',cancelled:'Cancelada'
};
const periods = {manha:'Manhã',tarde:'Tarde',noite:'Noite'};
const id = new URLSearchParams(location.search).get('id') || '';
const show = (selector,value) => { $(selector).textContent = String(value ?? '—'); };
const element = (tag,className,text) => {
  const node = document.createElement(tag);
  if(className) node.className = className;
  if(text!==undefined) node.textContent = String(text);
  return node;
};
function displayError(message, needsLogin=false) {
  const box = $('#team-message');
  box.replaceChildren();
  box.classList.add('is-error');
  box.append(document.createTextNode(message + ' '));
  if(needsLogin){const link = element('a','','Entrar no painel →');link.href='./';box.append(link);}
  box.hidden = false;
  $('#team-panel').hidden = true;
}
function formatDate(date) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return String(date||'—');
  const [y,m,d] = date.split('-'); return `${d}/${m}/${y}`;
}
function renderPlayer(player,position) {
  const own = !String(player?.equipment_id ?? '').trim();
  const card = element('article','team-player' + (own?' own':''));
  const number = Number(player?.number);
  const badge = element('span','team-player-number',Number.isInteger(number) && number>0 ? number : position+1);
  const content = element('div','team-player-main');
  const name = element('h3','team-player-name',player?.name?.trim() || 'Nome não registrado');
  const equipment = element('span','team-equipment-value',own
    ? 'Equipamento próprio / sem aluguel'
    : (player?.equipment_name?.trim() || 'Equipamento alugado (nome indisponível)'));
  content.append(name);
  if(player?.registered_by_invitation===true)content.append(element('small','team-equipment-label','NOME CONFIRMADO PELO CONVITE'));
  content.append(element('small','team-equipment-label',own?'EQUIPAMENTO':'EQUIPAMENTO ALUGADO'),equipment);
  card.append(badge,content);
  return card;
}
function render(reservation) {
  show('#team-customer',reservation.customer_name || 'Nome não informado');
  show('#team-protocol',`Protocolo: ${reservation.id ?? '—'}`);
  show('#team-status',statuses[reservation.status] || reservation.status || '—');
  $('#team-approval').innerHTML=renderApprovalControls(reservation);
  show('#team-date',formatDate(reservation.date));
  show('#team-period',reservation.period_label || periods[reservation.period] || reservation.period || '—');
  const players = Array.isArray(reservation.players) ? reservation.players : [];
  const rented = players.filter(player => String(player?.equipment_id ?? '').trim()).length;
  const count = Number(reservation.player_count) || players.length;
  show('#team-count',count);
  show('#team-rented',rented);
  show('#team-own',players.length-rented);
  show('#team-list-count',`${players.length} participante(s) identificado(s)`);
  const list = $('#team-players');
  list.replaceChildren();
  if(players.length) players.forEach((player,index)=>list.append(renderPlayer(player,index)));
  else list.append(element('p','team-empty','Esta reserva não possui nomes e equipamentos individuais registrados. Pode ser um cadastro antigo.'));
  if(players.length<count) list.append(element('p','team-empty',`Esta reserva informa ${count} jogadores, mas apenas ${players.length} constam no cadastro individual. Confira os dados no sistema.`));
  const registrations=Array.isArray(reservation.invite_registrations)?reservation.invite_registrations:[];
  show('#team-invite-count',`${Number(reservation.registered_people)||registrations.length} de ${count} vaga(s) cadastrada(s)`);
  const invited=$('#team-invite-players');invited.replaceChildren();
  if(registrations.length) registrations.forEach((person,index)=>{
    const card=element('article','team-player');
    const content=element('div','team-player-main');
    content.append(element('h3','team-player-name',person.name||'Nome não informado'),element('small','team-equipment-label','WHATSAPP'),element('span','team-equipment-value',person.whatsapp||'Não informado'));
    // O administrador pode corrigir inclusive cadastros antigos, sem chave de edição.
    const changeName=element('button','team-invite-edit-button','Alterar nome');
    changeName.type='button';
    changeName.addEventListener('click',()=>{
      changeName.hidden=true;
      const editor=element('form','team-invite-editor');
      const label=element('label','','Nome do participante');
      const input=element('input');input.type='text';input.name='name';input.required=true;
      input.minLength=2;input.maxLength=120;input.value=String(person.name||'');
      label.append(input);
      const feedback=element('p','team-edit-feedback');feedback.setAttribute('role','status');
      const buttons=element('div','team-edit-actions');
      const save=element('button','team-invite-save','Salvar');save.type='submit';
      const cancel=element('button','team-invite-cancel','Cancelar');cancel.type='button';
      cancel.addEventListener('click',()=>{editor.remove();changeName.hidden=false;});
      buttons.append(save,cancel);editor.append(label,feedback,buttons);content.append(editor);
      editor.addEventListener('submit',async event=>{
        event.preventDefault();
        const name=input.value.trim();
        if(name.length<2||name.length>120){feedback.textContent='Informe um nome válido.';return;}
        save.disabled=true;feedback.textContent='Salvando…';
        try{
          await api(`/reservations/${encodeURIComponent(id)}/participants/${encodeURIComponent(person.id)}`,{
            method:'PATCH',body:JSON.stringify({name})
          });
          await loadTeam();
        }catch(error){feedback.textContent=error.message;save.disabled=false;}
      });
      input.focus();
    });
    const shareEdit=element('button','team-invite-edit-button','Gerar link para jogador');
    shareEdit.type='button';
    const feedback=element('p','team-edit-feedback'); feedback.setAttribute('role','status');
    shareEdit.addEventListener('click',async()=>{
      if(!confirm('Gerar novo link individual para '+(person.name||'este jogador')+'? Um link anterior deixará de funcionar.'))return;
      shareEdit.disabled=true;feedback.textContent='Gerando link privado…';
      try {
        const result=await api(`/reservations/${encodeURIComponent(id)}/participants/${encodeURIComponent(person.id)}/edit-link`,{method:'POST'});
        const url=new URL(result.edit_path,location.origin).href;
        try {await navigator.clipboard.writeText(url); feedback.textContent='Link privado copiado! Envie somente ao próprio jogador.';}
        catch { feedback.replaceChildren(document.createTextNode('Copie e envie apenas ao jogador: '));const a=element('a','','Link privado');a.href=url;a.target='_blank';a.rel='noopener noreferrer';feedback.append(a);const code=element('textarea');code.readOnly=true;code.value=url;code.rows=2;code.style.width='100%';feedback.append(code);}
      } catch(error){ feedback.textContent=error.message; }
      finally {shareEdit.disabled=false;}
    });
    content.append(changeName,shareEdit,feedback);
    card.append(element('span','team-player-number',index+1),content);invited.append(card);
  });
  else invited.append(element('p','team-empty','Nenhum jogador se cadastrou pelo convite até agora. Atualize esta página para consultar novos cadastros.'));
  $('#team-message').hidden = true;
  $('#team-panel').hidden = false;
}
async function loadTeam() {
  const button=$('#team-reload');button.disabled=true;
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)){
    displayError('O identificador da reserva está ausente ou inválido. Volte ao painel e selecione uma reserva.');
    return;
  }
  const message = $('#team-message');
  message.classList.remove('is-error');message.textContent='Carregando os dados da equipe…';message.hidden=false;
  try {
    if(!csrfToken){const me=await api('/auth/me');csrfToken=me.csrf;}
    const result = await api(`/reservations/${encodeURIComponent(id)}`);
    render(result);
  }catch(error){displayError(error.message,error.status===401);}
  finally{button.disabled=false;}
}
$('#team-reload').addEventListener('click',loadTeam);
bindApprovalControls($('#team-approval'), {api,refresh:()=>loadTeam(),onError:error=>{
  if(error.status===401)displayError(error.message,true);
}});
loadTeam();
