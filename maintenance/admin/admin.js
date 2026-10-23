import { buildOpenListWhatsAppMessage } from './whatsapp-message.js?v=20261023-mapa-1';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = n => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);
const escape = t => String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let csrfToken = '';
const api = async (path, options={}) => {
  const headers={'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method && options.method!=='GET'?{'X-CSRF-Token':csrfToken}:{})};
  const resp=await fetch('../api/admin'+path,{credentials:'same-origin',...options,headers});
  const json=await resp.json().catch(()=>({}));if(!resp.ok){const err=new Error(json.detail|| (resp.status===503?'API indisponível. Verifique o banco e a configuração PHP.':'Não foi possível concluir a solicitação.'));err.status=resp.status;err.code=json.code||'';throw err;}return json;
};
function alert(text,ok=false,login=false){const el=$(login?'#login-alert':'#panel-alert');el.hidden=!text;el.textContent=text;el.classList.toggle('ok',ok);if(text)el.scrollIntoView({block:'nearest'});}
function show(auth){$('#login').hidden=auth;$('#panel').hidden=!auth;$('#logout').hidden=!auth;}
async function start(){try{const me=await api('/auth/me');csrfToken=me.csrf;show(true);$('#admin-welcome').textContent=`Sessão ativa: ${me.email}`;await refresh();}catch(err){show(false);if(err?.status!==401)alert(err?.message||'Não foi possível carregar o painel. Confira a conexão com o servidor.',false,true);}}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{const v=Object.fromEntries(new FormData(e.target));const r=await api('/auth/login',{method:'POST',body:JSON.stringify(v)});csrfToken=r.csrf;show(true);await refresh();}catch(err){alert(err.message,false,true);}finally{b.disabled=false;}});
$('#logout').addEventListener('click',async()=>{try{await api('/auth/logout',{method:'POST',body:'{}'});}finally{csrfToken='';show(false);}});
$('#refresh').addEventListener('click',()=>refresh());
$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>{$$('[data-tab]').forEach(el=>el.classList.toggle('active',el===b));$$('[data-pane]').forEach(el=>el.hidden=el.dataset.pane!==b.dataset.tab);}));
async function refresh(){alert('');try{await Promise.all([dashboard(),reservations(),calendar(),catalog(),openList(),suggestions(),settings()]);}catch(err){alert(err.message);}}
async function dashboard(){const d=await api('/dashboard');const labels={pending:'Reservas pendentes',awaiting_payment:'Aguardando pagamento',confirmed:'Confirmadas',open_list_new:'Novos interessados',suggestions_new:'Sugestões novas'};$('#stats').innerHTML=Object.entries(labels).map(([k,v])=>`<div class="stat"><strong>${Number(d.counts[k]||0)}</strong><span>${v}</span></div>`).join('');}
const statusOptions = [['pending','Pendente'],['awaiting_payment','Aguardando pagamento'],['payment_sent','Comprovante enviado'],['confirmed','Confirmada'],['cancelled','Cancelada']];
const makeOptions=(value,opts)=>opts.map(([id,label])=>`<option value="${escape(id)}" ${id===value?'selected':''}>${escape(label)}</option>`).join('');
async function reservations(){const status=$('#status-filter').value;const rs=await api('/reservations'+(status?'?status='+encodeURIComponent(status):''));$('#reservations-body').innerHTML=rs.length?rs.map(r=>`<tr><td><b>${escape(r.customer_name)}</b><small>${escape(r.id)} · ${escape(r.customer_whatsapp)}</small></td><td>${escape(r.date)}<small>${escape(r.period)}</small></td><td>${Number(r.player_count)}</td><td>${fmt(r.total)}</td><td><select data-res="${escape(r.id)}">${makeOptions(r.status,statusOptions)}</select></td><td><button data-res-save="${escape(r.id)}">Salvar</button> <button class="danger" data-res-del="${escape(r.id)}">Excluir</button></td></tr>`).join(''):'<tr><td colspan="6">Nenhuma reserva encontrada.</td></tr>';}
$('#status-filter').addEventListener('change',()=>reservations());
$('#reservations-body').addEventListener('click',async e=>{
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
async function catalog(){const kind=$('#catalog-kind').value;products=await api('/'+kind);$('#catalog-body').innerHTML=products.map(p=>`<tr><td><b>${escape(p.name)}</b><small>${escape(p.id)}</small></td><td>${fmt(p.price)}</td><td>${kind==='equipment'?p.units_available:kind==='ammo'?p.ammo_count:'—'}</td><td>${p.active?'Sim':'Não'}</td><td><button data-product-edit="${escape(p.id)}">Editar</button> <button class="danger" data-product-del="${escape(p.id)}">Desativar</button></td></tr>`).join('')||'<tr><td colspan="5">Nenhum produto.</td></tr>';}
$('#catalog-kind').addEventListener('change',()=>{clearProduct();catalog();$('#ammo-included-field').hidden=$('#catalog-kind').value!=='equipment';});
$('#inventory-form').addEventListener('submit',async e=>{e.preventDefault();try{const date=e.target.elements.date.value;const report=await api('/equipment-report?date='+encodeURIComponent(date));$('#inventory-result').innerHTML='<div class="table-scroll"><table><thead><tr><th>Equipamento</th><th>Unidades totais</th><th>Reservadas</th><th>Livres</th></tr></thead><tbody>'+report.map(r=>`<tr><td>${escape(r.name)}</td><td>${Number(r.units_available)}</td><td>${Number(r.units_reserved)}</td><td>${Number(r.units_free)}</td></tr>`).join('')+'</tbody></table></div>';}catch(err){alert(err.message);}});
function clearProduct(){$('#product-form').reset();$('#product-heading').textContent='Novo item';}
$('#product-clear').addEventListener('click',clearProduct);
$('#catalog-body').addEventListener('click',async e=>{const id=e.target.closest('[data-product-edit],[data-product-del]');if(!id)return;const p=products.find(p=>p.id===(id.dataset.productEdit||id.dataset.productDel));if(!p)return;if(id.hasAttribute('data-product-del')){if(!confirm('Desativar produto?'))return;try{await api('/'+$('#catalog-kind').value+'/'+p.id,{method:'DELETE'});await catalog();}catch(err){alert(err.message);}return;}
const f=$('#product-form');f.elements.id.value=p.id;f.elements.name.value=p.name;f.elements.price.value=p.price;f.elements.units.value=p.units_available??p.ammo_count??1;f.elements.ammo.value=p.ammo??0;f.elements.active.checked=!!p.active;$('#product-heading').textContent='Editar: '+p.name;f.scrollIntoView({behavior:'smooth',block:'center'});});
$('#product-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.target.elements;const id=f.id.value;const kind=$('#catalog-kind').value;const current=products.find(p=>p.id===id);const val={name:f.name.value,price:Number(f.price.value),active:f.active.checked,order:current?.order??0};if(kind==='equipment'){val.units_available=Number(f.units.value);val.ammo=Number(f.ammo.value);}if(kind==='ammo')val.ammo_count=Number(f.units.value);try{await api('/'+kind+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(val)});clearProduct();await catalog();alert('Produto salvo.',true);}catch(err){alert(err.message);}});
const contactStatus = s => ({new:'Novo',contacted:'Contatado',resolved:'Resolvido',archived:'Arquivado'})[s] || s || '—';
async function loadContactItems(kind,tbody){
 const items=await api('/'+kind);
 if(kind==='open-list'){cachedOpenRegistrations=items;renderWhatsappMessage();}
 if(kind==='suggestions'){
  $(tbody).innerHTML=items.map(o=>`<tr><td><b>${escape(o.name)}</b><small>${escape(o.whatsapp)}</small></td><td>${escape(o.message)}</td><td>${escape(o.rating||'—')}</td><td>${escape(contactStatus(o.status))}</td><td><div class="contact-actions"><button data-contact-kind="suggestions" data-contact-id="${escape(o.id)}" data-contact-status="contacted" ${o.status==='contacted'?'disabled':''}>Marcar contatado</button><button class="danger" data-contact-action="delete" data-contact-kind="suggestions" data-contact-id="${escape(o.id)}" aria-label="Excluir sugestão de ${escape(o.name)}">Excluir</button></div></td></tr>`).join('')||'<tr><td colspan="5">Nenhum cadastro.</td></tr>';
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
  return `<tr><td><b>${escape(o.name)}</b><small>${escape(o.whatsapp)}</small></td><td>${Number(o.people_count)}${companionsHtml}</td><td><b>${escape(name)}</b><small>${escape(o.event_date||o.preferred_date||'Sem data')} · ${escape(period)}</small>${o.notes?`<small>Obs.: ${escape(o.notes)}</small>`:''}</td><td>${escape(contactStatus(o.status))}</td><td><div class="contact-actions">${o.status==='archived'?'':`<button data-contact-kind="open-list" data-contact-id="${escape(o.id)}" data-contact-status="contacted" ${o.status==='contacted'?'disabled':''}>Contatado</button> <button class="danger" data-contact-kind="open-list" data-contact-id="${escape(o.id)}" data-contact-status="archived">Arquivar</button>`}<button class="danger" data-contact-action="delete" data-contact-kind="open-list" data-contact-id="${escape(o.id)}" aria-label="Excluir inscrição de ${escape(o.name)}">Excluir</button></div></td></tr>`;
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
async function settings(){const s=await api('/settings');cachedShareSettings=s;renderWhatsappMessage();const f=$('#settings-form');for(const [key,value] of Object.entries(s)){const input=f.elements.namedItem(key);if(input)input.value=value??'';}}
$('#settings-form').addEventListener('submit',async e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));values.entry_fee=Number(values.entry_fee);values.deposit_percent=Number(values.deposit_percent);try{await api('/settings',{method:'PUT',body:JSON.stringify(values)});cachedShareSettings=values;renderWhatsappMessage();alert('Configurações salvas.',true);}catch(err){alert(err.message);}});
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
