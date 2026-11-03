import { createPhotoManager } from './photos-manager.js?v=20261031-galeria1';
import { createAdminAlerts } from './admin-alerts.js?v=20261031-aprovacao';
import { createMobilePush } from './mobile-push.js?v=20261029-v12-18';
import { renderReservationPlayers } from './reservations-view.js?v=20261101-nomes-v18';
import { buildPlayerRoster, drawBalancedTeams, teamsAsText } from './team-draw.js?v=20261029-v12-3';
import { buildOpenListWhatsAppMessage } from './whatsapp-message.js?v=20261023-schema-v9-2';
import { approvalStatus, invitationUrl, copyInvitation, renderApprovalControls, bindApprovalControls } from './closed-list-approval.js?v=20261031-convite-fix';
import { whatsAppHref, buildOpenListContactMessage, buildClosedListContactMessage, buildSuggestionContactMessage } from '../assets/js/services/WhatsAppBooking.js?v=20261027-pagamento-v11-10';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = n => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);
const escape = t => String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** O nome leva a ficha privada; o telefone abre WhatsApp com mensagem pronta. */
function contactPhoneLink(number, message, name) {
 const href=whatsAppHref(number,message);
 const visible=escape(number || 'Número não informado');
 return href ? `<a class="admin-whatsapp-link" href="${escape(href)}" target="_blank" rel="noopener noreferrer" title="Conversar com ${escape(name)} no WhatsApp" aria-label="Abrir WhatsApp de ${escape(name)}: ${visible}">${visible} <span aria-hidden="true">↗ WhatsApp</span></a>`
             : `<small class="admin-phone-unavailable">${visible}</small>`;
}
/** Botão Contatado: abre o WhatsApp com texto preenchido (envio manual).
 * O mesmo link continua disponível para contatos já registrados como contatados.
 */
function contactWhatsAppButton(person, kind, message) {
 const href=whatsAppHref(person.whatsapp,message);
 if(!href) return '<button type="button" disabled title="Cadastre um WhatsApp válido para abrir a conversa">Contatado</button>';
 const alreadyContacted=person.status==='contacted';
 const label=alreadyContacted?'Reabrir WhatsApp de':'Abrir WhatsApp de';
 return `<a class="contact-whatsapp-button${alreadyContacted?' is-contacted':''}" href="${escape(href)}" target="_blank" rel="noopener noreferrer" data-contact-whatsapp data-contact-kind="${escape(kind)}" data-contact-id="${escape(person.id)}" data-contact-current="${escape(person.status||'new')}" title="${escape(label+' '+person.name+' com mensagem pronta')}" aria-label="${escape(label+' '+person.name+' com mensagem pronta')}">Contatado <span aria-hidden="true">↗</span></a>`;
}
let csrfToken = '';
const api = async (path, options={}) => {
  const headers={'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method && options.method!=='GET'?{'X-CSRF-Token':csrfToken}:{})};
  const resp=await fetch('../api/admin'+path,{credentials:'same-origin',...options,headers});
  const json=await resp.json().catch(()=>({}));if(!resp.ok){const err=new Error(json.detail|| (resp.status===503?'API indisponível. Verifique o banco e a configuração PHP.':'Não foi possível concluir a solicitação.'));err.status=resp.status;err.code=json.code||'';throw err;}return json;
};
const mobilePush = createMobilePush({api});
const photoManager = createPhotoManager({api,getCsrf:()=>csrfToken});
const adminAlerts = createAdminAlerts({
 api,
 onOpen: item => {
  if(item.kind === 'closed') {
   window.location.href = 'reserva.html?id=' + encodeURIComponent(item.entity_id);
  } else {
   document.querySelector('[data-tab="open-list"]')?.click();
   openList().catch(err => alert(err.message));
  }
 }
});
function alert(text,ok=false,login=false){const el=$(login?'#login-alert':'#panel-alert');el.hidden=!text;el.textContent=text;el.classList.toggle('ok',ok);if(text)el.scrollIntoView({block:'nearest'});}
function show(auth){$('#login').hidden=auth;$('#panel').hidden=!auth;$('#logout').hidden=!auth;}
let currentRole='admin';
function applyAccess(role,email){
 currentRole=role==='photos'?'photos':'admin';
 const photosOnly=currentRole==='photos';
 $('#panel').classList.toggle('photos-only',photosOnly);
 $('#panel .intro .eyebrow').textContent=photosOnly?'CAMPO FERRARI / GALERIA':'CAMPO FERRARI / CONTROLE';
 $('#panel .intro h1').textContent=photosOnly?'Gerenciar fotos':'Central de gerenciamento';
 $('#admin-welcome').textContent=photosOnly?`Acesso somente à galeria: ${email}`:`Sessão ativa: ${email}`;
 $('#refresh').textContent=photosOnly?'Atualizar fotos ↻':'Atualizar ↻';
 $$('[data-tab]').forEach(tab=>{
   tab.hidden=photosOnly && tab.dataset.tab!=='photos';
   tab.classList.toggle('active',tab.dataset.tab===(photosOnly?'photos':'reservations'));
 });
 $$('[data-pane]').forEach(pane=>pane.hidden=pane.dataset.pane!==(photosOnly?'photos':'reservations'));
}
async function authenticatedSession(me){
 csrfToken=me.csrf;
 applyAccess(me.role,me.email);
 show(true);
 if(currentRole==='photos'){
   await photoManager.load();
   return; // Sem consultas de reservas, clientes, alertas, configurações ou banco.
 }
 await refresh();
 await adminAlerts.start(me.email);
 await mobilePush.start();
 await adminAccountsStatus();
}
async function start(){
 try{const me=await api('/auth/me');await authenticatedSession(me);}
 catch(err){show(false);if(err?.status!==401)alert(err?.message||'Não foi possível carregar o painel. Confira a conexão com o servidor.',false,true);}
}
$('#login-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;
 try{const v=Object.fromEntries(new FormData(e.target));const me=await api('/auth/login',{method:'POST',body:JSON.stringify(v)});await authenticatedSession(me);}
 catch(err){alert(err.message,false,true);}
 finally{b.disabled=false;}
});
$('#logout').addEventListener('click',async()=>{
 try{await api('/auth/logout',{method:'POST',body:'{}'});}
 finally{adminAlerts.stop();mobilePush.stop();csrfToken='';currentRole='admin';show(false);}
});
$('#refresh').addEventListener('click',async()=>{
 if(currentRole==='photos'){await photoManager.load();return;}
 await refresh();
 if(document.querySelector('[data-tab="photos"].active'))await photoManager.load();
 await adminAlerts.poll();
});
$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>{
 if(currentRole==='photos' && b.dataset.tab!=='photos')return;
 $$('[data-tab]').forEach(el=>el.classList.toggle('active',el===b));
 $$('[data-pane]').forEach(el=>el.hidden=el.dataset.pane!==b.dataset.tab);
 if(b.dataset.tab==='photos')photoManager.load();
}));
async function refresh(){alert('');try{await Promise.all([schemaStatus(),dashboard(),reservations(),calendar(),catalog(),openList(),suggestions(),settings(),notificationSettings()]);}catch(err){alert(err.message);}}
async function dashboard(){const d=await api('/dashboard');const labels={pending:'Aguardando análise',awaiting_payment:'Aguardando pagamento',confirmed:'Confirmadas',open_list_new:'Novos interessados',suggestions_new:'Sugestões novas'};$('#stats').innerHTML=Object.entries(labels).map(([k,v])=>`<div class="stat"><strong>${Number(d.counts[k]||0)}</strong><span>${v}</span></div>`).join('');}
const statusOptions = [['pending','Pendente'],['awaiting_payment','Aguardando pagamento'],['payment_sent','Comprovante enviado'],['confirmed','Confirmada'],['cancelled','Cancelada']];
const makeOptions=(value,opts)=>opts.map(([id,label])=>`<option value="${escape(id)}" ${id===value?'selected':''}>${escape(label)}</option>`).join('');
/** Sorteio apenas no navegador, vinculado à reserva selecionada. Não grava no banco. */
let reservationCache = new Map();
let activeTeamDraw = null;
let teamDrawResult = null;
let teamDrawOpener = null;

const reservationBadge = reservation => {
  const approval = approvalStatus(reservation);
  if (approval === 'pending') return {label:'Aguardando aprovação', cls:'waiting'};
  if (approval === 'rejected') return {label:'Não aprovada', cls:'cancelled'};
  const states = {
    pending:['Pendente','waiting'], awaiting_payment:['Aguardando pagamento','waiting'],
    payment_sent:['Comprovante enviado','waiting'], confirmed:['Confirmada','confirmed'],
    cancelled:['Cancelada','cancelled']
  };
  const [label,cls] = states[reservation.status] || ['Aprovada','approved'];
  return {label,cls};
};
const readableReservationDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
  ? `${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}` : (value || 'Data a confirmar');
const shareReservationLink = (reservation, url) => {
  const title = reservation.request_kind === 'evento_fechado' ? 'evento fechado' : 'lista fechada';
  const date = readableReservationDate(reservation.date);
  const period = String(reservation.period_label || reservation.period || 'A confirmar').replace(/[\r\n]/g,' ');
  const message = [
    'CAMPO FERRARI AIRSOFT', '',
    `O cadastro para a ${title} está liberado!`,
    `Data: ${date}`,
    `Turno: ${period}`,
    '', 'Cadastre-se pelo link abaixo:', url,
    '', 'Compartilhe o link somente com os participantes do jogo.'
  ].join('\n');
  // Compartilhamento sem destinatário fixo: o administrador escolhe o contato ou grupo.
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
};

/** Cartão resumido + detalhes recolhíveis. Preserva o sistema de aprovação, situação e sorteio. */
function renderReservationCard(r, expanded) {
  const id=String(r.id);
  const safeId=escape(id);
  const count=Math.max(Number(r.player_count)||0,Array.isArray(r.players)?r.players.length:0);
  const editable=approvalStatus(r)==='approved';
  const url=invitationUrl(r);
  const badge=reservationBadge(r);
  const date=readableReservationDate(r.date);
  const period=r.period_label || r.period || 'Turno a confirmar';
  const label=r.request_kind==='evento_fechado'?'Evento fechado':'Lista fechada';
  const total=r.request_kind==='evento_fechado'?'Valor sob consulta':fmt(r.total);
  const issue=r.invitation_issue || 'none';
  const quickActions=url
    ? `<button type="button" class="res-quick-copy" data-res-quick-copy="${safeId}" aria-label="Copiar link de cadastro da reserva de ${escape(r.customer_name)}">⧉ Copiar link</button><a class="res-quick-whatsapp" href="${escape(shareReservationLink(r,url))}" target="_blank" rel="noopener noreferrer" aria-label="Compartilhar link de ${escape(r.customer_name)} no WhatsApp">Enviar no WhatsApp ↗</a>`
    : approvalStatus(r)==='approved' && ['missing_approval','missing_token'].includes(issue)
      ? `<button type="button" class="res-quick-generate" data-res-quick-generate="${safeId}">Gerar link de cadastro ↗</button><span class="res-link-unavailable">Reserva aprovada, mas convite ainda não gerado.</span>`
      : `<span class="res-link-unavailable">${approvalStatus(r)==='pending'?'Link liberado após aprovação':approvalStatus(r)==='rejected'?'Solicitação não aprovada':issue==='closed'?'Inscrições encerradas para esta data/turno':issue==='schema_missing'?'Atualize o banco em Configurações > Manutenção do MySQL':issue==='legacy_pending'?'Reserva antiga pendente: confirme a situação primeiro':'Link indisponível — atualize o painel'}</span>`;
  return `<article class="reservation-card" data-res-card="${safeId}">
    <details class="reservation-card-disclosure" data-res-details="${safeId}" ${expanded.has(id)?'open':''}>
      <summary class="reservation-card-summary">
        <span class="res-summary-person"><span class="res-summary-label">${escape(label)}</span><strong>${escape(r.customer_name || 'Cliente não informado')}</strong><small>Protocolo: ${safeId}</small></span>
        <span class="res-summary-info"><small>Data e turno</small><strong>${escape(date)}</strong><span>${escape(period)}</span></span>
        <span class="res-summary-info"><small>Jogadores</small><strong>${count} participante${count===1?'':'s'}</strong><span>${Number(r.registered_people)||0} cadastro(s) pelo convite</span></span>
        <span class="res-summary-state"><span class="res-state-badge is-${badge.cls}">${escape(badge.label)}</span><small>${escape(total)}</small></span>
        <span class="res-summary-expand"><span>Detalhes</span><span class="res-chevron" aria-hidden="true">⌄</span></span>
      </summary>
      <div class="reservation-card-details">
        <section class="res-detail-block res-contact-block"><h3>Cliente e contato</h3>
          <a class="admin-customer-link" href="reserva.html?id=${encodeURIComponent(id)}">Ver ficha da equipe ↗</a>
          ${contactPhoneLink(r.customer_whatsapp,(r.request_kind==='evento_fechado'?`Olá, ${r.customer_name}! Vamos conversar sobre sua solicitação de evento fechado no Campo Ferrari, protocolo ${r.id}. Valores e equipamentos serão combinados com a equipe.`:buildClosedListContactMessage(r)),r.customer_name)}
          <small>Valor: <strong>${escape(total)}</strong></small>
        </section>
        <section class="res-detail-block res-player-block"><h3>Jogadores e equipamentos (${count})</h3>
          ${renderReservationPlayers(r.players)}
          <small>${Number(r.registered_people)||0} cadastro(s) pelo convite · <a href="reserva.html?id=${encodeURIComponent(id)}">Ver cadastros</a></small>
        </section>
        <section class="res-detail-block res-control-block"><h3>Gerenciar solicitação</h3>
          <div class="res-status-controls"><label>Situação da reserva<select data-res="${safeId}" ${editable?'':'disabled'}>${makeOptions(r.status,statusOptions)}</select></label>${editable?`<button type="button" data-res-save="${safeId}">Salvar situação</button>`:'<small>Defina a aprovação antes de alterar a situação.</small>'}</div>
          ${renderApprovalControls(r)}
          <div class="reservation-secondary-actions"><button type="button" class="danger" data-res-del="${safeId}">Excluir</button><button type="button" class="team-draw-open" data-res-draw="${safeId}" ${count<2?'disabled title="É necessário ter pelo menos dois jogadores"':''}>🎲 Sortear times</button></div>
        </section>
      </div>
    </details>
    <div class="reservation-card-quick-actions">${quickActions}<span class="res-quick-feedback" data-res-quick-feedback="${safeId}" role="status" aria-live="polite"></span></div>
  </article>`;
}

async function reservations(){
  const status=$('#status-filter').value;
  const root=$('#reservations-body');
  const expanded=new Set($$('details[data-res-details][open]').map(item=>item.dataset.resDetails));
  const rs=await api('/reservations'+(status?'?status='+encodeURIComponent(status):''));
  reservationCache=new Map(rs.map(r=>[String(r.id),r]));
  if($('#team-draw-dialog').open)closeTeamDraw();
  $('#reservation-count').textContent=`${rs.length} ${rs.length===1?'reserva encontrada':'reservas encontradas'}`;
  root.innerHTML=rs.length?rs.map(r=>renderReservationCard(r,expanded)).join(''):'<p class="reservation-no-results">Nenhuma reserva encontrada para esse filtro.</p>';
}


const teamDrawDialog=$('#team-draw-dialog');
function closeTeamDraw(){
 if(teamDrawDialog.open) teamDrawDialog.close();
 activeTeamDraw=null;
 teamDrawResult=null;
}
function showTeamDraw(id,opener){
 const reservation=reservationCache.get(id);
 if(!reservation)return;
 const players=buildPlayerRoster(reservation);
 if(players.length<2){alert('É necessário ter pelo menos dois jogadores para sortear.');return;}
 activeTeamDraw={reservation,players};
 teamDrawOpener=opener;
 const context=reservation.customer_name || 'Reserva sem nome';
 $('#team-draw-context').textContent=`${context} · ${reservation.date||'Data não informada'} · ${reservation.period_label||reservation.period||'Turno não informado'} · ${players.length} jogadores`;
 const maxTeams=Math.min(8,players.length);
 $('#team-draw-count').replaceChildren(...Array.from({length:maxTeams-1},(_,i)=>{
  const option=document.createElement('option');option.value=String(i+2);option.textContent=`${i+2} times`;return option;
 }));
 $('#team-draw-count').value='2';
 $('#team-draw-status').textContent='';
 teamDrawDialog.showModal();
 rerollTeamDraw();
}
function rerollTeamDraw(){
 if(!activeTeamDraw)return;
 const count=Number($('#team-draw-count').value);
 try{
  teamDrawResult=drawBalancedTeams(activeTeamDraw.players,count);
  $('#team-draw-results').innerHTML=teamDrawResult.map((players,index)=>`<section class="team-draw-card"><h4>Time ${index+1} <small>${players.length} jogador(es)</small></h4><ol>${players.map(p=>`<li value="${p.number}"><span>${escape(p.name)}</span></li>`).join('')}</ol></section>`).join('');
  $('#team-draw-copy').disabled=false;
  $('#team-draw-status').textContent='Sorteio realizado. Para gerar outros grupos, clique em Sortear novamente.';
 }catch(err){
  teamDrawResult=null;$('#team-draw-copy').disabled=true;
  $('#team-draw-results').textContent='';$('#team-draw-status').textContent=err.message;
 }
}
$('#team-draw-close').addEventListener('click',closeTeamDraw);
teamDrawDialog.addEventListener('close',()=>{activeTeamDraw=null;teamDrawResult=null;teamDrawOpener?.focus();teamDrawOpener=null;});
teamDrawDialog.addEventListener('click',e=>{if(e.target===teamDrawDialog)closeTeamDraw();});
$('#team-draw-count').addEventListener('change',rerollTeamDraw);
$('#team-draw-shuffle').addEventListener('click',rerollTeamDraw);
$('#team-draw-copy').addEventListener('click',async()=>{
 if(!teamDrawResult || !activeTeamDraw)return;
 const reservation=activeTeamDraw.reservation;
 const text=teamsAsText(teamDrawResult,{
  customer:reservation.customer_name, date:reservation.date, period:reservation.period_label||reservation.period
 });
 try{
  if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
  else {
   const scratch=document.createElement('textarea');scratch.value=text;scratch.style.position='fixed';scratch.style.opacity='0';document.body.append(scratch);scratch.select();
   const didCopy=document.execCommand('copy');scratch.remove();if(!didCopy)throw Error('Cópia não autorizada pelo navegador.');
  }
  $('#team-draw-status').textContent='Times copiados! Cole a lista onde preferir.';
 }catch(err){$('#team-draw-status').textContent='Não foi possível copiar automaticamente. Verifique a permissão de área de transferência do navegador.';}
});
// Nomes alterados no convite são refletidos no painel sem precisar reabrir o site.
// Evita refazer o HTML se o administrador está preenchendo um formulário.
setInterval(()=>{
  const pane=document.querySelector('[data-pane="reservations"]');
  if(document.hidden || $('#panel').hidden || !pane || pane.hidden || teamDrawDialog.open)return;
  if($('#reservations-body').querySelector('input:focus, select:focus, textarea:focus'))return;
  reservations().catch(()=>{});
},20000);
$('#status-filter').addEventListener('change',()=>reservations());
$('#reservations-expand-all').addEventListener('click',()=>$$('#reservations-body details[data-res-details]').forEach(el=>el.open=true));
$('#reservations-collapse-all').addEventListener('click',()=>$$('#reservations-body details[data-res-details]').forEach(el=>el.open=false));
bindApprovalControls($('#reservations-body'), {api, refresh:async decision=>{
 await Promise.all([reservations(),dashboard(),calendar()]);
 const feedback=decision==='approve'?'Lista aprovada. O link de cadastro está disponível para compartilhar.'
  :decision==='invitation'?'Link de cadastro gerado! Use Copiar link ou Enviar no WhatsApp no cartão.'
  :'Solicitação não aprovada. O cadastro por link não foi liberado.';
 alert(feedback,true);
 await adminAlerts.poll();
}, onError:error=>alert(error.message)});
$('#reservations-body').addEventListener('click',async e=>{
 const generate=e.target.closest('[data-res-quick-generate]');
 if(generate){
  const id=String(generate.dataset.resQuickGenerate);
  const feedback=generate.closest('.reservation-card')?.querySelector('[data-res-quick-feedback]');
  generate.disabled=true;
  if(feedback)feedback.textContent='Gerando link seguro…';
  try{
   const reservation=await api(`/reservations/${encodeURIComponent(id)}/invitation`,{method:'POST'});
   if(!invitationUrl(reservation))throw Error('O convite foi salvo, mas o link não foi retornado. Atualize o painel.');
   await reservations();
   const updated=[...document.querySelectorAll('[data-res-quick-feedback]')].find(n=>n.dataset.resQuickFeedback===id);
   if(updated)updated.textContent='Link gerado! Agora você pode copiar ou enviar no WhatsApp.';
  }catch(error){if(feedback)feedback.textContent=error.message||'Não foi possível gerar o convite.';}
  finally{generate.disabled=false;}
  return;
 }
 const quick=e.target.closest('[data-res-quick-copy]');
 if(quick){
  const reservation=reservationCache.get(String(quick.dataset.resQuickCopy));
  const url=reservation?invitationUrl(reservation):'';
  const feedback=quick.closest('.reservation-card')?.querySelector('[data-res-quick-feedback]');
  if(!url){if(feedback)feedback.textContent='O link ainda não está disponível.';return;}
  quick.disabled=true;
  try{await copyInvitation(url);if(feedback)feedback.textContent='Link copiado! Cole no WhatsApp ou onde preferir.';}
  catch(error){if(feedback)feedback.textContent=error.message||'Não foi possível copiar o link.';}
  finally{quick.disabled=false;}
  return;
 }
 const draw=e.target.closest('[data-res-draw]');
 if(draw){showTeamDraw(draw.dataset.resDraw,draw);return;}
 const save=e.target.closest('[data-res-save]'),del=e.target.closest('[data-res-del]');if(!save&&!del)return;
 const id=(save||del).dataset[save?'resSave':'resDel'];try{if(del){if(!confirm('Excluir permanentemente essa reserva?'))return;await api('/reservations/'+id,{method:'DELETE'});}else{const status=$$('[data-res]').find(s=>s.dataset.res===id)?.value;await api('/reservations/'+id,{method:'PATCH',body:JSON.stringify({status})});}alert('Reserva atualizada.',true);await reservations();await dashboard();}catch(err){alert(err.message);}
});
let publishedOpenEvents=[];
let cachedOpenRegistrations=null;
let cachedShareSettings=null;

function updateWhatsappEventSelect(){
 const select=$('#whatsapp-event-select');
 const current=select.value;
 select.innerHTML='<option value="">Selecione um evento</option>'
  +publishedOpenEvents.map(evt=>`<option value="${escape(evt.id)}">${escape(evt.date)} — ${escape(evt.title)} · ${escape(evt.period_label||evt.period)}</option>`).join('');
 const preferred=$('#event-filter').value;
 if(publishedOpenEvents.some(evt=>evt.id===current)) select.value=current;
 else if(publishedOpenEvents.some(evt=>evt.id===preferred)) select.value=preferred;
 else select.value=publishedOpenEvents.find(evt=>!evt.has_started)?.id||publishedOpenEvents[0]?.id||'';
 renderWhatsappMessage();
}

function renderWhatsappMessage(){
 const selectedId=$('#whatsapp-event-select').value;
 const evt=publishedOpenEvents.find(x=>x.id===selectedId);
 const textarea=$('#whatsapp-message');
 const copy=$('#whatsapp-copy');
 const regen=$('#whatsapp-regenerate');
 if(!evt){textarea.value='';textarea.disabled=true;copy.disabled=regen.disabled=true;$('#whatsapp-share-status').textContent='Selecione uma lista aberta publicada para montar a mensagem.';return;}
 if(cachedOpenRegistrations===null || cachedShareSettings===null){
  textarea.disabled=true;copy.disabled=regen.disabled=true;
  $('#whatsapp-share-status').textContent='Carregando inscrições e configurações para gerar a mensagem…';return;
 }
 const result=buildOpenListWhatsAppMessage(evt,cachedOpenRegistrations,cachedShareSettings,{
  includeCompanionFirstNames:$('#whatsapp-include-companions').checked,
 });
 textarea.value=result.message;
 textarea.disabled=false;
 copy.disabled=regen.disabled=!result.message;
 $('#whatsapp-share-status').textContent=
  `${result.occupied} participante(s) cadastrado(s)${result.capacity===null?'':` · ${result.remaining} vaga(s) restantes`}. `
  +(result.warning||'Confira as informações antes de compartilhar.');
}

$('#whatsapp-event-select').addEventListener('change',renderWhatsappMessage);
$('#whatsapp-include-companions').addEventListener('change',renderWhatsappMessage);
$('#whatsapp-regenerate').addEventListener('click',async()=>{
 const btn=$('#whatsapp-regenerate');btn.disabled=true;
 try{await Promise.all([calendar(),openList(),settings()]);renderWhatsappMessage();}
 catch(err){alert(err.message);$('#whatsapp-share-status').textContent='Não foi possível atualizar: '+err.message;}
 finally{btn.disabled=false;}
});
$('#whatsapp-copy').addEventListener('click',async()=>{
 const textarea=$('#whatsapp-message');const message=textarea.value.trim();
 if(!message)return;
 const button=$('#whatsapp-copy');button.disabled=true;
 try{
  if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(message);
  else {textarea.focus();textarea.select();if(!document.execCommand('copy'))throw new Error('Falha na cópia.');}
  $('#whatsapp-share-status').textContent='Mensagem copiada! Cole no WhatsApp após conferir os dados.';
 }catch{
  textarea.focus();textarea.select();
  $('#whatsapp-share-status').textContent='Não foi possível copiar automaticamente. Use Ctrl+C (ou Copiar no celular).';
 }finally{button.disabled=false;}
});
async function calendar(){
 const [blocks,events]=await Promise.all([api('/blocked-dates'),api('/open-events')]);
 publishedOpenEvents=events;
 $('#blocked-list').innerHTML=blocks.length?blocks.map(d=>`<article><span><b>${escape(d.date)}</b> <small>${escape(d.reason)}</small></span><button class="danger" data-block-delete="${escape(d.id)}">Desbloquear</button></article>`).join(''):'<p class="muted">Nenhum bloqueio.</p>';
 $('#events-list').innerHTML=events.length?events.map(d=>{
  const period=d.period_label||'Horário a confirmar';
  const slots=d.max_players===null?'Sem limite informado':`${Number(d.registered_people)} / ${Number(d.max_players)} participantes · ${Number(d.remaining_places)} vagas restantes`;
  return `<article class="admin-event"><span><b>${escape(d.title)}</b><small>${escape(d.date)} · ${escape(period)} (${escape(d.period_time||d.time_info||'')})</small><small>${escape(slots)}</small>${d.notes?`<small>${escape(d.notes)}</small>`:''}</span><div class="admin-event-actions"><button data-event-manage="${escape(d.id)}">Ver inscritos</button><button class="danger" data-event-delete="${escape(d.id)}">Remover</button></div></article>`;
 }).join(''):'<p class="muted">Nenhuma lista aberta criada.</p>';
 const filter=$('#event-filter'), selected=filter.value;
 filter.innerHTML='<option value="">Todos os eventos</option>'+events.map(d=>`<option value="${escape(d.id)}">${escape(d.date+' — '+d.title)}</option>`).join('')+'<option value="legacy">Inscrições antigas / sem evento</option>';
 filter.value=[...filter.options].some(o=>o.value===selected)?selected:'';
 updateWhatsappEventSelect();
}
$('#event-form [name="date"]').min=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
$('#events-list').addEventListener('click',event=>{
 const button=event.target.closest('[data-event-manage]');
 if (!button) return;
 $('#event-filter').value=button.dataset.eventManage;
 $('#whatsapp-event-select').value=button.dataset.eventManage;renderWhatsappMessage();
 const tab=document.querySelector('[data-tab="open-list"]');tab.click();openList();
});
for(const [form,path] of [['#block-form','/blocked-dates'],['#event-form','/open-events']])$(form).addEventListener('submit',async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.target));try{await api(path,{method:'POST',body:JSON.stringify(v)});e.target.reset();alert('Data salva.',true);await calendar();}catch(err){alert(err.message);}});
for(const [holder,path,attribute] of [['#blocked-list','/blocked-dates','blockDelete'],['#events-list','/open-events','eventDelete']])$(holder).addEventListener('click',async e=>{const id=e.target.closest('button')?.dataset[attribute];if(!id||!confirm('Remover este registro?'))return;try{await api(path+'/'+id,{method:'DELETE'});await calendar();}catch(err){alert(err.message);}});
let products=[];
let catalogOrderSaving=false;
let catalogDraggedId=null;
function catalogOrderMessage(message, failed=false) {
 const el=$('#catalog-order-status');
 el.textContent=message;
 el.classList.toggle('catalog-order-error',failed);
}
async function catalog(){
 const kind=$('#catalog-kind').value;
 const data=await api('/'+kind);
 // Don't allow a refresh from a previous tab selection to overwrite current items.
 if(kind!==$('#catalog-kind').value)return;
 products=data;
 $('#catalog-body').innerHTML=products.map((p,index)=>{
  const disabledPrevious=index===0?'disabled':'';
  const disabledNext=index===products.length-1?'disabled':'';
  const productName=escape(p.name);
  return `<tr draggable="true" data-catalog-row="${escape(p.id)}" aria-label="${productName}, posição ${index+1}">
   <td><div class="catalog-order-cell"><span class="catalog-position" title="Posição atual">${index+1}</span>
   <div class="catalog-order-actions" role="group" aria-label="Alterar posição de ${productName}">
     <button type="button" data-product-move="${escape(p.id)}" data-direction="-1" aria-label="Subir ${productName}" title="Subir uma posição" ${disabledPrevious}>↑</button>
     <button type="button" data-product-move="${escape(p.id)}" data-direction="1" aria-label="Descer ${productName}" title="Descer uma posição" ${disabledNext}>↓</button>
   </div></div></td>
   <td><b>${productName}</b><small>${escape(p.id)}</small></td>
   <td>${fmt(p.price)}</td>
   <td>${kind==='equipment'||kind==='accessories'?Number(p.units_available??0):p.ammo_count}</td>
   <td>${p.active?'Sim':'Não'}</td>
   <td><button data-product-edit="${escape(p.id)}">Editar</button> <button class="danger" data-product-del="${escape(p.id)}">Desativar</button></td>
  </tr>`;
 }).join('')||'<tr><td colspan="6">Nenhum produto cadastrado.</td></tr>';
}
async function saveCatalogOrder(newIds){
 if(catalogOrderSaving)return;
 const kind=$('#catalog-kind').value;
 const oldIds=products.map(p=>p.id);
 if(newIds.join('|')===oldIds.join('|'))return;
 catalogOrderSaving=true;
 $('#catalog-body').classList.add('is-order-saving');
 $('#catalog-body').querySelectorAll('button').forEach(button=>button.disabled=true);
 catalogOrderMessage('Salvando nova ordem…');
 try{
  await api('/catalog/reorder',{method:'PUT',body:JSON.stringify({kind,ids:newIds})});
  await catalog();
  catalogOrderMessage('Ordem salva! Os itens aparecerão nesta sequência para os clientes.');
 }catch(err){
  await catalog().catch(()=>{});
  catalogOrderMessage(err.message || 'Não foi possível salvar a ordem.',true);
 }finally{
  catalogOrderSaving=false;
  $('#catalog-body').classList.remove('is-order-saving');
 }
}
$('#catalog-kind').addEventListener('change',()=>{clearProduct();catalogOrderMessage('');catalog();});
$('#catalog-body').addEventListener('click',event=>{
 const move=event.target.closest('button[data-product-move]');
 if(!move||catalogOrderSaving)return;
 const from=products.findIndex(p=>p.id===move.dataset.productMove);
 const to=from+Number(move.dataset.direction);
 if(from<0||to<0||to>=products.length)return;
 const ids=products.map(p=>p.id);
 ids.splice(to,0,ids.splice(from,1)[0]);
 saveCatalogOrder(ids);
});
// Drag-and-drop on desktop; arrow buttons remain accessible for touch and keyboard.
$('#catalog-body').addEventListener('dragstart',event=>{
 const row=event.target.closest('[data-catalog-row]');
 if(!row||catalogOrderSaving)return event.preventDefault();
 catalogDraggedId=row.dataset.catalogRow;
 row.classList.add('catalog-row-dragging');
 event.dataTransfer.effectAllowed='move';
 event.dataTransfer.setData('text/plain',catalogDraggedId);
});
$('#catalog-body').addEventListener('dragover',event=>{
 const row=event.target.closest('[data-catalog-row]');
 if(!row||!catalogDraggedId||catalogOrderSaving)return;
 event.preventDefault();
 event.dataTransfer.dropEffect='move';
 $('#catalog-body').querySelectorAll('.catalog-row-drop-target').forEach(el=>el.classList.remove('catalog-row-drop-target'));
 if(row.dataset.catalogRow!==catalogDraggedId)row.classList.add('catalog-row-drop-target');
});
$('#catalog-body').addEventListener('drop',event=>{
 const row=event.target.closest('[data-catalog-row]');
 event.preventDefault();
 if(!row||!catalogDraggedId||catalogOrderSaving)return;
 const from=products.findIndex(p=>p.id===catalogDraggedId);
 const to=products.findIndex(p=>p.id===row.dataset.catalogRow);
 if(from<0||to<0)return;
 const ids=products.map(p=>p.id);
 ids.splice(to,0,ids.splice(from,1)[0]);
 catalogDraggedId=null;
 saveCatalogOrder(ids);
});
$('#catalog-body').addEventListener('dragend',()=>{
 catalogDraggedId=null;
 $('#catalog-body').querySelectorAll('.catalog-row-dragging,.catalog-row-drop-target').forEach(row=>row.classList.remove('catalog-row-dragging','catalog-row-drop-target'));
});
function clearProduct(){$('#product-form').reset();$('#product-heading').textContent='Novo item';updateProductFields();}
function updateProductFields(){
 const kind=$('#catalog-kind').value;
 $('#product-units-field').firstChild.textContent=kind==='ammo'?'Quantidade de munições':'Unidades disponíveis em estoque';
 $('#product-units-field input').max=kind==='ammo'?'200000':'1000';
 $('#product-units-help').textContent=kind==='accessories'?'Estoque máximo do acessório por turno. Use 0 para indisponível.':'';
 $('#ammo-included-field').hidden=kind!=='equipment';
}
$('#product-clear').addEventListener('click',clearProduct);
$('#catalog-body').addEventListener('click',async e=>{const id=e.target.closest('[data-product-edit],[data-product-del]');if(!id)return;const p=products.find(p=>p.id===(id.dataset.productEdit||id.dataset.productDel));if(!p)return;if(id.hasAttribute('data-product-del')){if(!confirm('Desativar produto?'))return;try{await api('/'+$('#catalog-kind').value+'/'+p.id,{method:'DELETE'});await catalog();}catch(err){alert(err.message);}return;}
const f=$('#product-form');f.elements.id.value=p.id;f.elements.name.value=p.name;f.elements.price.value=p.price;f.elements.units.value=p.units_available??p.ammo_count??1;f.elements.ammo.value=p.ammo??0;f.elements.active.checked=!!p.active;$('#product-heading').textContent='Editar: '+p.name;f.scrollIntoView({behavior:'smooth',block:'center'});});
$('#product-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.target.elements;const id=f.id.value;const kind=$('#catalog-kind').value;const val={name:f.name.value,price:Number(f.price.value),active:f.active.checked};if(kind==='equipment'){val.units_available=Number(f.units.value);val.ammo=Number(f.ammo.value);}if(kind==='accessories')val.units_available=Number(f.units.value);if(kind==='ammo')val.ammo_count=Number(f.units.value);try{await api('/'+kind+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(val)});clearProduct();await catalog();alert('Produto salvo.',true);}catch(err){alert(err.message);}});
const contactStatus = s => ({new:'Novo',contacted:'Contatado',resolved:'Resolvido',archived:'Arquivado'})[s] || s || '—';
async function loadContactItems(kind,tbody){
 const items=await api('/'+kind);
 if(kind==='open-list'){cachedOpenRegistrations=items;renderWhatsappMessage();}
 if(kind==='suggestions'){
  $(tbody).innerHTML=items.map(o=>`<tr><td><b>${escape(o.name)}</b>${contactPhoneLink(o.whatsapp,buildSuggestionContactMessage(o),o.name)}</td><td>${escape(o.message)}</td><td>${escape(o.rating||'—')}</td><td>${escape(contactStatus(o.status))}</td><td><div class="contact-actions">${contactWhatsAppButton(o,'suggestions',buildSuggestionContactMessage(o))}<button class="danger" data-contact-action="delete" data-contact-kind="suggestions" data-contact-id="${escape(o.id)}" aria-label="Excluir sugestão de ${escape(o.name)}">Excluir</button></div></td></tr>`).join('')||'<tr><td colspan="5">Nenhum cadastro.</td></tr>';
  return;
 }
 const filter=$('#event-filter').value;
 const filtered=items.filter(o=>!filter||(filter==='legacy'?!o.event_id:o.event_id===filter));
 $(tbody).innerHTML=filtered.map(o=>{
  const period=({manha:'Manhã (08:00–13:00)',tarde:'Tarde (13:30–18:30)',noite:'Noite (19:00–23:30)'})[o.preferred_period]||'Horário a confirmar';
  const name=o.event_title|| (o.event_id?'Evento não disponível':'Cadastro anterior (sem evento)');
  const companions=Array.isArray(o.participant_names)?o.participant_names:[];
  const companionsHtml=companions.length
   ? `<small class="admin-companion-title">Outros participantes:</small><ol class="admin-companion-list">${companions.map(person=>`<li>${escape(person)}</li>`).join('')}</ol>`
   : Number(o.people_count)>1 ? '<small>Nomes não registrados (inscrição antiga).</small>' : '';
  return `<tr><td><b>${escape(o.name)}</b>${contactPhoneLink(o.whatsapp,buildOpenListContactMessage(o),o.name)}</td><td>${Number(o.people_count)}${companionsHtml}</td><td><b>${escape(name)}</b><small>${escape(o.event_date||o.preferred_date||'Sem data')} · ${escape(period)}</small>${o.notes?`<small>Obs.: ${escape(o.notes)}</small>`:''}</td><td>${escape(contactStatus(o.status))}</td><td><div class="contact-actions">${o.status==='archived'?'':`${contactWhatsAppButton(o,'open-list',buildOpenListContactMessage(o))} <button class="danger" data-contact-kind="open-list" data-contact-id="${escape(o.id)}" data-contact-status="archived">Arquivar</button>`}<button data-consent-id="${escape(o.id)}" data-consent-current="${Number(o.public_names_consent)||0}" title="Só autorize após confirmar permissão de todos os integrantes">${Number(o.public_names_consent)===1?'Revogar divulgação':'Autorizar nomes'}</button> <button class="danger" data-contact-action="delete" data-contact-kind="open-list" data-contact-id="${escape(o.id)}" aria-label="Excluir inscrição de ${escape(o.name)}">Excluir</button></div></td></tr>`;
 }).join('')||'<tr><td colspan="5">Nenhuma inscrição para esse filtro.</td></tr>';
}
async function openList(){await loadContactItems('open-list','#open-list-body');}
async function suggestions(){await loadContactItems('suggestions','#suggestions-body');}
$('#event-filter').addEventListener('change',()=>{
 const selected=$('#event-filter').value;
 if(publishedOpenEvents.some(evt=>evt.id===selected)){ $('#whatsapp-event-select').value=selected;renderWhatsappMessage(); }
 openList();
});
for(const target of ['#open-list-body','#suggestions-body'])$(target).addEventListener('click',async e=>{
 const consent=e.target.closest('button[data-consent-id]');
 if(consent) {
  const active=consent.dataset.consentCurrent==='1';
  const message=active
   ?'Revogar a divulgação dos nomes abreviados deste grupo?'
   :'Você confirma que verificou a autorização de TODOS os integrantes e dos responsáveis legais por menores antes de divulgar os nomes abreviados?';
  if(!confirm(message))return;
  consent.disabled=true;
  try {
   await api('/open-list/'+encodeURIComponent(consent.dataset.consentId),{
    method:'PATCH',body:JSON.stringify({public_names_consent:!active,consent_confirmed:!active})
   });
   await openList();
   alert(active?'Divulgação revogada.':'Autorização registrada. Confira a lista pública.',true);
  } catch(err) {alert(err.message);consent.disabled=false;}
  return;
 }
 // Não bloquear o clique: o navegador deve abrir o WhatsApp de imediato.
 // Atualizar o status em paralelo apenas no primeiro contato, sem presumir que a mensagem foi enviada.
 const whatsappLink=e.target.closest('a[data-contact-whatsapp]');
 if(whatsappLink){
  if(whatsappLink.dataset.contactCurrent==='contacted')return;
  const kind=whatsappLink.dataset.contactKind, id=whatsappLink.dataset.contactId;
  whatsappLink.dataset.contactCurrent='contacted';
  try {
   await api('/'+kind+'/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:'contacted'})});
   await loadContactItems(kind,target);
   await dashboard();
  }catch(err){
   whatsappLink.dataset.contactCurrent='new';
   alert('Não foi possível marcar como contatado: '+err.message);
  }
  return;
 }
 const b=e.target.closest('button[data-contact-id]');if(!b || b.disabled)return;
 const kind=b.dataset.contactKind, id=b.dataset.contactId;
 if(b.dataset.contactAction==='delete'){
  const prompt=kind==='open-list'
   ?'Excluir PERMANENTEMENTE esta inscrição? Esta ação não pode ser desfeita e liberará as vagas do evento.'
   :'Excluir PERMANENTEMENTE esta sugestão? Esta ação não pode ser desfeita.';
  if(!confirm(prompt))return;
  b.disabled=true;
  try {
   await api('/'+kind+'/'+encodeURIComponent(id),{method:'DELETE'});
   await loadContactItems(kind,target);
   if(kind==='open-list')await calendar();
   await dashboard();
   alert('Registro excluído permanentemente.',true);
  }catch(err){b.disabled=false;alert(err.message);}
  return;
 }
 if(b.dataset.contactStatus==='archived'&&!confirm('Arquivar esta inscrição e liberar as vagas desse participante?'))return;
 b.disabled=true;
 try {
  await api('/'+kind+'/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:b.dataset.contactStatus||'contacted'})});
  await loadContactItems(kind,target);
  if(kind==='open-list')await calendar();
  await dashboard();
 }catch(err){b.disabled=false;alert(err.message);}
});
// Envio automático só é habilitado no backend após configurar credenciais privadas.
async function notificationSettings(){
 const state=await api('/notifications');
 const form=$('#notification-form'), p=state.preferences, configured=state.configured;
 form.elements.email_to.value=p.email_to||'';
 form.elements.whatsapp_to.value=p.whatsapp_to||'';
 form.elements.email_enabled.checked=!!p.email_enabled;
 form.elements.whatsapp_enabled.checked=!!p.whatsapp_enabled;
 const migrated=p.ready;
 $('#notification-configuration').textContent=!migrated
  ? 'Atualização do MySQL pendente. Faça backup e aplique a migração na seção Manutenção abaixo.'
  : `SMTP: ${configured.email?'configurado':'não configurado'} · WhatsApp Business API: ${configured.whatsapp?'configurada':'não configurada'}. As credenciais ficam somente no servidor.`;
 for(const element of form.querySelectorAll('input,button'))element.disabled=!migrated;
 form.elements.email_enabled.disabled=!migrated;
 form.elements.whatsapp_enabled.disabled=!migrated;
 $('#notification-status').textContent='';
}
function notificationStatus(message,success=false){const el=$('#notification-status');el.textContent=message;el.classList.toggle('success',success);el.classList.toggle('error',!success);}
$('#notification-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget;
 const body={email_enabled:form.elements.email_enabled.checked,whatsapp_enabled:form.elements.whatsapp_enabled.checked,
  email_to:form.elements.email_to.value.trim(),whatsapp_to:form.elements.whatsapp_to.value.trim()};
 const btn=form.querySelector('button[type=submit]');btn.disabled=true;
 try{
  await api('/notifications',{method:'PUT',body:JSON.stringify(body)});
  notificationStatus('Preferências de notificação salvas.',true);
  await notificationSettings();notificationStatus('Preferências de notificação salvas.',true);
 }catch(err){notificationStatus(err.message);}
 finally{btn.disabled=false;}
});
$('#notification-form').addEventListener('click',async event=>{
 const button=event.target.closest('[data-notification-test]');if(!button)return;
 const channel=button.dataset.notificationTest;
 if(!confirm(`Enviar uma mensagem de TESTE para o destinatário salvo de ${channel==='email'?'e-mail':'WhatsApp'}? As preferências devem estar ativadas e salvas.`))return;
 button.disabled=true;
 try{
  const result=await api('/notifications/test',{method:'POST',body:JSON.stringify({channel})});
  const names={accepted:'aceita pelo provedor (entrega ainda não garantida)',disabled:'desativada',not_configured:'sem configuração',failed:'falhou — confira o log de erros do servidor'};
  notificationStatus(`${channel==='email'?'E-mail':'WhatsApp'}: ${names[result.status]||result.status}.`,result.status==='accepted');
 }catch(err){notificationStatus(err.message);}
 finally{button.disabled=false;}
});
// As preferencias sao individuais; quando as colunas ainda nao existem, mostra
// o valor legado sem permitir alteracoes ate a migracao segura do MySQL.
const periodPreferences = [
 { key:'allow_multiple_periods_closed', help:'multi-period-closed-help', label:'Lista Fechada' },
 { key:'allow_multiple_periods_private', help:'multi-period-private-help', label:'Evento Fechado' }
];
function describePeriodPreference(option, enabled, migrated, pending=false){
 const text=document.getElementById(option.help);
 if(!migrated){
  text.textContent='Bloqueado: faltam colunas no MySQL. Regra atual: '+(enabled?'vários turnos permitidos.':'apenas um turno.');
  return;
 }
 text.textContent=pending
  ? `Alteração da ${option.label} ainda não salva. Clique em Salvar configurações.`
  : (enabled?'Ativado: visitantes podem combinar turnos disponíveis.':'Desativado: visitantes escolhem apenas um turno.');
}
async function settings(){
 const s=await api('/settings');cachedShareSettings=s;renderWhatsappMessage();
 const f=$('#settings-form');
 let needsMigration=false;
 for(const [key,value] of Object.entries(s)){
  const input=f.elements.namedItem(key);
  if(input && input.type!=='checkbox')input.value=value??'';
 }
 for(const option of periodPreferences){
  const input=f.elements.namedItem(option.key);
  const migrated=Object.prototype.hasOwnProperty.call(s,option.key);
  if(!migrated)needsMigration=true;
  const enabled=Number(s[option.key]??s.allow_multiple_periods??1)===1;
  input.disabled=!migrated;
  input.checked=enabled;
  describePeriodPreference(option,enabled,migrated);
 }
 $('#multi-period-migration').hidden=!needsMigration;
 $('#multi-period-save-hint').hidden=needsMigration;
}
$('#multi-period-go-schema').addEventListener('click',()=>{
 const section=$('#schema-title');
 section?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
 $('#schema-check').focus({preventScroll:true});
 schemaStatus();
});
$('#settings-form').addEventListener('change',event=>{
 const option=periodPreferences.find(item=>item.key===event.target.name);
 if(option && !event.target.disabled)describePeriodPreference(option,event.target.checked,true,true);
});
$('#settings-form').addEventListener('submit',async e=>{
 e.preventDefault();
 const values=Object.fromEntries(new FormData(e.target));
 values.entry_fee=Number(values.entry_fee);values.deposit_percent=Number(values.deposit_percent);
 for(const option of periodPreferences){
  const input=e.target.elements.namedItem(option.key);
  delete values[option.key]; // evita enviar "on" (texto) ao servidor.
  if(!input.disabled)values[option.key]=input.checked?1:0;
 }
 const button=e.target.querySelector('button.primary');button.disabled=true;
 try{
  const saved=await api('/settings',{method:'PUT',body:JSON.stringify(values)});
  cachedShareSettings=saved;renderWhatsappMessage();
  await settings();alert('Configurações salvas. Cada modalidade passou a ter sua própria regra de turnos.',true);
 }catch(err){alert(err.message);}
 finally{button.disabled=false;}
});
// Status e migracao do banco: somente com a sessao administrativa.
let currentSchemaState=null;
async function schemaStatus(){
 const output=$('#schema-status'), details=$('#schema-missing');
 try{
  const state=await api('/schema'); currentSchemaState=state;
  const missing=Array.isArray(state.missing)?state.missing:[];
  output.textContent=missing.length
   ? `Banco ${state.database}: faltam ${missing.length} ajuste(s) de estrutura. Atualizacao necessaria.`
   : `Banco ${state.database}: estrutura atualizada. Nenhuma migracao pendente.`;
  details.textContent=missing.length?'Estruturas pendentes: '+missing.join(', '):'';
  $('#schema-migrate').disabled=!missing.length || !$('#schema-backup').checked;
 }catch(err){
  currentSchemaState=null;
  output.textContent='Nao foi possivel verificar o banco: '+err.message;
  details.textContent='Confira o banco configurado em api/config.local.php e as tabelas existentes.';
  $('#schema-migrate').disabled=true;
 }
}
$('#schema-check').addEventListener('click',schemaStatus);
$('#schema-backup').addEventListener('change',()=>{
 $('#schema-migrate').disabled=!$('#schema-backup').checked || !currentSchemaState?.missing?.length;
});
$('#schema-migrate').addEventListener('click',async()=>{
 if(!$('#schema-backup').checked || !currentSchemaState?.missing?.length)return;
 if(!confirm('Confirma que realizou backup do banco exibido acima? A atualizacao das colunas nao pode ser desfeita automaticamente.'))return;
 const btn=$('#schema-migrate');btn.disabled=true;
 $('#schema-status').textContent='Aplicando as atualizações de tabelas e colunas que faltam...';
 try{
  const result=await api('/schema/migrate',{method:'POST',body:JSON.stringify({backup_confirmed:true})});
  alert(`Banco atualizado. ${result.changed.length} atualização(ões) aplicada(s).`,true);
  await schemaStatus();
  if(result.schema==='ok')await refresh();
 }catch(err){alert(err.message);await schemaStatus();}
 finally{btn.disabled=!$('#schema-backup').checked || !currentSchemaState?.missing?.length;}
});

// A instalação precisa ser confirmada no painel de produção (não há acesso remoto ao banco no ZIP).
async function adminAccountsStatus(){
  const status=$('#admin-accounts-status');
  try{
    const result=await api('/users/provision');
    const missing=result.accounts.filter(item=>!item.exists);
    status.textContent=missing.length
      ? `${result.accounts.length-missing.length} de 2 acesso(s) já cadastrado(s). Clique em ativar após confirmar.`
      : 'Os dois e-mails já possuem contas administrativas. Senhas existentes não foram alteradas.';
    $('#admin-accounts-create').disabled=!$('#admin-accounts-confirm').checked || !missing.length || !result.installer_available;
  }catch(error){status.textContent=error.message;$('#admin-accounts-create').disabled=true;}
}
$('#admin-accounts-confirm').addEventListener('change',adminAccountsStatus);
$('#admin-accounts-create').addEventListener('click',async()=>{
  if(!$('#admin-accounts-confirm').checked)return;
  if(!confirm('Ativar os acessos? adm.campoferrari terá acesso completo; novacriative ficará somente em Fotos / Galeria.'))return;
  const button=$('#admin-accounts-create');button.disabled=true;
  const status=$('#admin-accounts-status');status.textContent='Criando usuários no MySQL…';
  try{
    const result=await api('/users/provision',{method:'POST',body:JSON.stringify({confirmed:true})});
    status.textContent=`Criados: ${result.created.join(', ') || 'nenhum (já existiam)'}. Contas existentes preservadas.`;
    $('#admin-accounts-confirm').checked=false;
    await adminAccountsStatus();
  }catch(error){status.textContent=error.message;button.disabled=false;}
});

$('#ammo-included-field').hidden=false;start();

// Configuração inicial: disponível somente quando não há administrador cadastrado.
(async function setupInitialAdmin(){
 const section=document.querySelector('#setup-container');
 try { const r=await fetch('../api/admin/setup',{credentials:'same-origin'});const v=await r.json();section.hidden=!v.setup_required; }catch{section.hidden=true;}
 document.querySelector('#setup-form').addEventListener('submit',async function(e){
 e.preventDefault();const btn=this.querySelector('button');btn.disabled=true;const notice=document.querySelector('#setup-alert');
 try {const r=await fetch('../api/admin/setup',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(this)))});const v=await r.json();if(!r.ok)throw new Error(v.detail||'Não foi possível configurar.');notice.hidden=false;notice.textContent='Conta criada. Faça login acima.';this.reset();section.querySelector('form').hidden=true;}
 catch(err){notice.hidden=false;notice.textContent=err.message;}finally{btn.disabled=false;}
 });
})();
