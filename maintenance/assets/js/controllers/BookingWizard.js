/** Reservas em JavaScript com API PHP 8 + MySQL no Laragon. */
const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const escape = (text) => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (value) => moneyFormatter.format(Number(value) || 0);
export const todayLocal = (date = new Date()) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
export const formatDate = (day) => /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : day;
export const validPhone = (phone) => { const digits = String(phone ?? '').replace(/\D/g, ''); return digits.length >= 10 && digits.length <= 13; };
export const nonnegativeQty = (value, limit = 10) => Math.max(0, Math.min(limit, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0));
export const aggregateEquipment = (selected) => {
  const counts = new Map();
  for (const id of selected) if (id) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts].map(([id, qty]) => ({ id, qty }));
};
export function buildReservationPayload({date, period, count, selections, accessories, ammo, name, whatsapp, notes}) {
  if (!date || !period || !Number.isInteger(count) || count < 4 || count > 10) throw new Error('Escolha uma data, turno e grupo de 4 a 10 pessoas.');
  const quantities = obj => Object.entries(obj).filter(([, qty]) => qty > 0).map(([id, qty]) => ({ id, qty }));
  return {
    modality: 'lista_fechada', date, period, player_count: count,
    players: selections.slice(0, count).map(id => ({equipment_id: id || null})),
    equipment_selections: aggregateEquipment(selections.slice(0, count)),
    accessory_selections: quantities(accessories), ammo_selections: quantities(ammo),
    customer_name: name || 'Prévia de valores', customer_whatsapp: whatsapp || 'Prévia', notes: notes || ''
  };
}
export class BookingWizard {
  constructor(config, fetcher = globalThis.fetch?.bind(globalThis)) {
    this.root = document.querySelector('#booking-widget');
    this.config = config;
    this.fetcher = fetcher;
    this.apiBase = (config.apiBaseUrl || '').replace(/\/$/, '');
    this.mode = 'closed'; this.step = 1; this.today = todayLocal();
    const d = new Date(); this.year = d.getFullYear(); this.month = d.getMonth() + 1;
    this.selectedDate = ''; this.period = ''; this.count = 6; this.minPlayers = 4;
    this.selections = Array(6).fill(''); this.accessoriesQty = {}; this.ammoQty = {};
    this.catalog = { equipment: [], accessories: [], ammo: [] };
    this.settings = null; this.availableEquipment = null; this.days = []; this.periods = [];
    this.preview = null; this.reservation = null;
    this.events = []; this.activeEvent = null;
    this.isBusy = false; this.monthToken = 0; this.periodToken = 0; this.equipmentToken = 0;
  }
  q(selector) { return this.root.querySelector(selector); }
  async api(path, options = {}) {
    if (!this.fetcher) throw new Error('Navegador sem suporte para conexão de dados.');
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) };
    let response;
    try { response = await this.fetcher(`${this.apiBase}/api${path}`, { ...options, headers }); }
    catch { throw new Error('Não foi possível conectar ao sistema. Confira sua internet ou tente novamente.'); }
    let data;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      const detail = data?.detail;
      const message = typeof detail === 'string' ? detail : 'Não foi possível concluir a operação. Tente novamente.';
      throw new Error(message);
    }
    if (data === null) throw new Error('A API não retornou JSON válido. Confira as rotas PHP e a configuração do servidor.');
    return data;
  }
  init() {
    if (!this.root) return;
    this.root.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => this.setMode(button.dataset.mode)));
    this.q('#cf-prev-month').addEventListener('click', () => this.changeMonth(-1));
    this.q('#cf-next-month').addEventListener('click', () => this.changeMonth(1));
    this.q('#cf-calendar-days').addEventListener('click', event => {
      const button = event.target.closest('[data-date]');
      if (!button || button.disabled) return;
      if (button.dataset.openEvent === 'true') {
        // Dia sem turno livre: o calendário leva à Lista Aberta.
        this.openEventForDatePeriod(button.dataset.date);
      } else {
        // Mesmo que haja Lista Aberta neste dia, os outros turnos são selecionáveis.
        this.selectDate(button.dataset.date);
      }
    });
    this.q('#cf-periods').addEventListener('click', event => {
      const open = event.target.closest('[data-open-event-period]');
      if (open) { this.openEventForDatePeriod(this.selectedDate, open.dataset.openEventPeriod); return; }
      const button = event.target.closest('[data-period]');
      if (button && !button.disabled) this.selectPeriod(button.dataset.period);
    });
    this.q('#cf-to-equipment').addEventListener('click', () => this.goToEquipment());
    this.q('#cf-back-date').addEventListener('click', () => this.setStep(1));
    this.q('#cf-minus-player').addEventListener('click', () => this.changePlayers(-1));
    this.q('#cf-plus-player').addEventListener('click', () => this.changePlayers(1));
    this.q('#cf-player-equipment').addEventListener('change', event => this.changeEquipment(event));
    for (const section of ['accessories', 'ammo']) {
      this.q(`#cf-${section}`).addEventListener('click', event => this.changeExtra(event, section));
    }
    this.q('#cf-to-review').addEventListener('click', () => this.goToReview());
    this.q('#cf-back-equipment').addEventListener('click', () => this.setStep(2));
    this.q('#cf-reservation-form').addEventListener('submit', event => { event.preventDefault(); this.confirm(); });
    const openForm = this.q('#cf-open-form');
    openForm.addEventListener('submit', event => { event.preventDefault(); this.joinOpenList(); });
    const participantCount = openForm.elements.people_count;
    participantCount.addEventListener('input', () => this.renderOpenCompanions());
    participantCount.addEventListener('change', () => this.renderOpenCompanions());
    this.q('#cf-open-back-events').addEventListener('click', () => this.showOpenEvents());
    this.q('#cf-open-reload').addEventListener('click', () => this.loadOpenEvents());
    this.q('#cf-copy-pix').addEventListener('click', () => this.copyPix());
    this.q('#cf-new-reservation').addEventListener('click', () => this.resetClosed());
    this.q('#cf-new-open').addEventListener('click', () => {
      this.q('#cf-open-form').reset();
      this.renderOpenCompanions();
      this.q('#cf-open-success').hidden = true;
      this.showOpenEvents(); this.loadOpenEvents();
    });
    // A navegação das etapas é opcional: só permite retornar a etapas já abertas.
    this.root.querySelectorAll('[data-step-nav]').forEach(button => {
      button.addEventListener('click', () => {
        const target = Number(button.dataset.stepNav);
        if (!button.disabled && target < this.step) this.setStep(target);
      });
    });
    this.q('#cf-edit-schedule').addEventListener('click', () => this.setStep(1));
    this.q('#cf-events-list').addEventListener('click', event => {
      const button = event.target.closest('[data-open-event-id]');
      if (button && !button.disabled) this.selectOpenEvent(button.dataset.openEventId);
    });
    this.renderCalendar(); this.renderPeriods(); this.renderPlayers(); this.renderExtras(); this.setStep(1);
    this.loadInitial();
  }
  async loadInitial() {
    const results = await Promise.allSettled([
      this.api('/settings/public'), this.api('/equipment'), this.api('/accessories'),
      this.api('/ammo'), this.api('/open-events')
    ]);
    const [settings, eq, acc, ammo, events] = results;
    if (settings.status === 'fulfilled') this.settings = settings.value;
    if (eq.status === 'fulfilled' && Array.isArray(eq.value)) this.catalog.equipment = eq.value;
    if (acc.status === 'fulfilled' && Array.isArray(acc.value)) this.catalog.accessories = acc.value;
    if (ammo.status === 'fulfilled' && Array.isArray(ammo.value)) this.catalog.ammo = ammo.value;
    if (events.status === 'fulfilled' && Array.isArray(events.value)) this.renderEvents(events.value);
    else this.q('#cf-events-list').innerHTML = '<p class="cf-muted">Não foi possível consultar as listas. Use “Atualizar eventos” para tentar novamente.</p>';
    this.catalogReady = [settings, eq, acc, ammo].every(item => item.status === 'fulfilled');
    // Evento de apresentação: publica somente a tarifa pública de entrada. O navegador
    // continua consultando o servidor para totais/estoques no fluxo já existente.
    const publicSettings = settings.status === 'fulfilled' && settings.value && typeof settings.value === 'object'
      ? settings.value : null;
    document.dispatchEvent(new CustomEvent('cf:pricing-state', {
      detail: { connected: Boolean(publicSettings), entryFee: publicSettings?.entry_fee ?? null }
    }));
    this.renderExtras();
    await this.loadMonth();
    if (!this.catalogReady && this.days.length) {
      this.setStatus(false, 'Calendário conectado · catálogo indisponível');
    }
  }
  setStatus(isConnected, message) {
    const label = this.q('#cf-api-status'); label.textContent = message;
    label.classList.toggle('is-connected', isConnected);
  }
  showError(target, message) { this.setError(target, message); }
  setError(id, message) {
    const box = this.q(`#${id}`);
    box.textContent = message; box.hidden = !message;
  }
  setMode(mode) {
    if (!['closed', 'open'].includes(mode)) return;
    this.mode = mode;
    this.q('#cf-closed').hidden = mode !== 'closed';
    this.q('#cf-open').hidden = mode !== 'open';
    this.root.querySelectorAll('[data-mode]').forEach(btn => {
      const active = btn.dataset.mode === mode; btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }
  selectExperience(id) {
    this.preference = id;
    const item = this.config.packages?.find(p => p.id === id);
    this.minPlayers = Math.min(10, Math.max(4, Number(item?.minPlayers) || 4));
    this.count = Math.max(this.minPlayers, this.count);
    while (this.selections.length < this.count) this.selections.push('');
    this.q('#cf-preference').hidden = !item;
    if (item) this.q('#cf-preference').textContent = `Experiência escolhida: ${item.name}. A modalidade e os equipamentos definem os valores calculados pela API.`;
    this.renderPlayers();
    this.setMode('closed');
    this.setStep(1);
  }
  setStep(step) {
    this.step = step;
    for (const i of [1, 2, 3]) {
      this.q(`#cf-step-${i}`).hidden = i !== step;
      const item = this.q(`.cf-steps [data-step="${i}"]`);
      item.classList.toggle('is-active', i === step);
      item.classList.toggle('is-complete', i < step);
      const control = item.querySelector('[data-step-nav]');
      control.disabled = i >= step;
      if (i === step) control.setAttribute('aria-current', 'step');
      else control.removeAttribute('aria-current');
      control.setAttribute('aria-label', `${['Data e turno', 'Equipamentos', 'Revisão'][i - 1]}${i < step ? ' — voltar' : ''}`);
    }
    if (step !== 4) this.q('#cf-closed-form').hidden = false;
    this.q('#cf-success').hidden = true;
    this.renderSelectionSummary();
  }
  renderSelectionSummary() {
    const time = this.periods.find(p => p.id === this.period);
    this.q('#cf-selection-summary').textContent = this.selectedDate && time
      ? `${formatDate(this.selectedDate)} · ${time.label} (${time.time})`
      : 'Escolha uma data e turno';
  }
  // Impede que o visitante mantenha um turno de um mês após navegar para outro.
  clearSchedule() {
    this.selectedDate = ''; this.period = ''; this.periods = [];
    this.availableEquipment = null; this.preview = null;
    this.periodToken++; this.equipmentToken++;
    this.selections.fill(''); this.accessoriesQty = {}; this.ammoQty = {};
    this.renderExtras();
    this.q('#cf-selected-date').textContent = 'Escolha uma data';
    this.setError('cf-period-error', '');
    this.setError('cf-step1-alert', '');
    this.renderPeriods(); this.updateNextDate(); this.renderSelectionSummary();
  }
  changeMonth(delta) {
    const next = new Date(this.year, this.month - 1 + delta, 1);
    const today = new Date(); const floor = new Date(today.getFullYear(), today.getMonth(), 1);
    if (next < floor) return;
    this.clearSchedule();
    this.year = next.getFullYear(); this.month = next.getMonth() + 1;
    this.loadMonth();
  }
  async loadMonth() {
    const token = ++this.monthToken;
    this.days = [];
    this.updateNextDate();
    this.q('#cf-calendar-days').innerHTML = '<span class="cf-loading">Consultando calendário…</span>';
    this.setError('cf-calendar-error', '');
    this.setStatus(false, 'Consultando disponibilidade…');
    try {
      const dates = await this.api(`/availability?year=${this.year}&month=${this.month}`);
      if (token !== this.monthToken) return;
      if (!Array.isArray(dates)) throw new Error('O sistema retornou um calendário inválido.');
      this.days = dates;
      // O servidor é a fonte da disponibilidade: nunca marcar dias livres
      // artificialmente quando a API estiver fora do ar.
      if (this.selectedDate && !dates.some(d => d.date === this.selectedDate && d.status === 'available')) {
        this.clearSchedule();
      }
      this.setStatus(true, 'Sistema conectado');
      this.renderCalendar();
      this.updateNextDate();
    } catch (error) {
      if (token !== this.monthToken) return;
      this.setStatus(false, 'Disponibilidade indisponível');
      this.renderCalendar();
      this.setError('cf-calendar-error', `${error.message} `);
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Tentar novamente ↻';
      btn.className = 'cf-retry-btn'; btn.addEventListener('click', () => this.loadMonth());
      this.q('#cf-calendar-error').append(btn);
    }
  }
  renderCalendar() {
    this.q('#cf-month-label').textContent = monthFormatter.format(new Date(this.year, this.month - 1, 1));
    const now = new Date();
    this.q('#cf-prev-month').disabled = this.year === now.getFullYear() && this.month === now.getMonth() + 1;
    const offset = new Date(this.year, this.month - 1, 1).getDay();
    const cells = Array.from({ length: offset }, () => '<span aria-hidden="true" class="cf-calendar-empty"></span>');
    for (const day of this.days) {
      const past = day.date < todayLocal();
      const open = day.has_open_event === true || day.status === 'open_event';
      const available = day.status === 'available' && !past;
      const state = available ? 'available' : open ? 'event' : 'taken';
      const label = `${formatDate(day.date)}: ${available ? 'turnos livres para reserva' : open ? 'lista aberta — ver inscrições' : 'indisponível'}${open && available ? '; também há Lista Aberta em outro turno' : ''}`;
      // A etiqueta ABERTA informa sobre o evento, mas NÃO bloqueia a seleção
      // do dia quando houver outros períodos livres para Lista Fechada.
      cells.push(`<button type="button" class="cf-calendar-day ${state} ${open ? 'has-open-event' : ''} ${this.selectedDate === day.date ? 'is-selected' : ''}" data-date="${escape(day.date)}" data-open-event="${open && !available && !past}" aria-label="${escape(label)}" title="${escape(label)}" ${available || (open && !past) ? '' : 'disabled'} ${this.selectedDate === day.date ? 'aria-pressed="true"' : 'aria-pressed="false"'}>${escape(Number(day.date.slice(-2)))}${open ? '<small>ABERTA</small>' : '<i aria-hidden="true"></i>'}</button>`);
    }
    this.q('#cf-calendar-days').innerHTML = cells.length ? cells.join('') : '<p class="cf-muted">O calendário não está disponível no momento.</p>';
  }
  async selectDate(day) {
    if (day < todayLocal() || !this.days.some(d => d.date === day && d.status === 'available')) return;
    this.clearSchedule();
    this.selectedDate = day;
    this.renderCalendar(); this.updateNextDate();
    this.q('#cf-selected-date').textContent = formatDate(day);
    await this.loadPeriods(day);
  }
  async loadPeriods(day = this.selectedDate) {
    if (!day || day !== this.selectedDate) return;
    this.setError('cf-period-error', '');
    this.q('#cf-periods').innerHTML = '<p class="cf-muted">Consultando turnos…</p>';
    const token = ++this.periodToken;
    try {
      const data = await this.api(`/day-periods?date=${encodeURIComponent(day)}`);
      if (token !== this.periodToken || day !== this.selectedDate) return;
      if (!Array.isArray(data)) throw new Error('Resposta de turnos inválida.');
      this.periods = data;
      this.renderPeriods();
    } catch (error) {
      if (token !== this.periodToken || day !== this.selectedDate) return;
      this.q('#cf-periods').innerHTML = '<p class="cf-muted">Falha ao consultar os turnos. Use a opção de tentar novamente.</p>';
      this.setError('cf-period-error', `${error.message} `);
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'cf-retry-btn'; retry.textContent = 'Tentar novamente ↻';
      retry.addEventListener('click', () => this.loadPeriods(day));
      this.q('#cf-period-error').append(retry);
    }
  }
  renderPeriods() {
    if (!this.selectedDate) { this.q('#cf-periods').innerHTML = '<p class="cf-muted">Selecione uma data no calendário para ver os turnos.</p>'; return; }
    if (!this.periods.length) { this.q('#cf-periods').innerHTML = '<p class="cf-muted">Nenhum turno disponível. Selecione outra data.</p>'; return; }
    this.q('#cf-periods').innerHTML = this.periods.map(p => {
      const available = p.status === 'available';
      const isOpen = p.status === 'open_event';
      const status = isOpen ? 'Lista aberta · ver evento ↗' : p.status === 'taken' ? 'Ocupado' : 'Indisponível';
      // A Lista Aberta pode ser consultada; somente as outras vagas permitem
      // continuar nas etapas de equipamentos e revisão da Lista Fechada.
      return `<button type="button" class="cf-period ${isOpen ? 'cf-period-open' : ''} ${this.period === p.id ? 'is-selected' : ''}" ${isOpen ? `data-open-event-period="${escape(p.id)}"` : `data-period="${escape(p.id)}"`} ${available || isOpen ? '' : 'disabled'} aria-pressed="${this.period === p.id}"><span><b>${escape(p.label)}</b><small>${escape(p.time)}</small></span><em>${available ? (this.period === p.id ? '✓ Selecionado' : 'Disponível') : status}</em></button>`;
    }).join('');
  }
  openEventForDatePeriod(date, period = '') {
    this.setMode('open');
    const event = this.events.find(e => e.date === date && (!period || e.period === period));
    if (event && event.can_register) this.selectOpenEvent(event.id);
    else this.showOpenEvents();
    if (!event) this.loadOpenEvents();
    this.q('#cf-open-events').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  selectPeriod(period) {
    if (!this.periods.some(p => p.id === period && p.status === 'available')) return;
    this.period = period; this.availableEquipment = null; this.equipmentToken++;
    this.selections.fill(''); this.renderPeriods(); this.updateNextDate(); this.renderSelectionSummary();
    this.setError('cf-step1-alert', '');
  }
  updateNextDate() {
    this.q('#cf-to-equipment').disabled = !(
      this.selectedDate && this.period &&
      this.days.some(d => d.date === this.selectedDate && d.status === 'available') &&
      this.periods.some(p => p.id === this.period && p.status === 'available')
    );
  }
  async loadEquipmentAvailability() {
    const date = this.selectedDate, period = this.period;
    const token = ++this.equipmentToken;
    const results = await this.api(`/equipment/availability?date=${encodeURIComponent(date)}&period=${encodeURIComponent(period)}`);
    if (token !== this.equipmentToken || date !== this.selectedDate || period !== this.period) return false;
    if (!Array.isArray(results)) throw new Error('Não foi possível verificar os equipamentos.');
    this.availableEquipment = results;
    return true;
  }
  async goToEquipment() {
    if (this.isBusy || !this.selectedDate || !this.period ||
        !this.days.some(d => d.date === this.selectedDate && d.status === 'available')) return;
    this.setError('cf-step1-alert', ''); this.isBusy = true;
    const btn = this.q('#cf-to-equipment'); btn.disabled = true; btn.textContent = 'Consultando…';
    try {
      if (!this.catalogReady) throw new Error('Catálogo indisponível. O servidor de reservas precisa estar ativo. Atualize a página ou tente novamente.');
      if (!this.periods.some(p => p.id === this.period && p.status === 'available')) throw new Error('O turno selecionado não está mais disponível.');
      if (!(await this.loadEquipmentAvailability())) return;
      this.renderPlayers(); this.renderExtras(); this.setStep(2);
    } catch (error) { this.setError('cf-step1-alert', error.message); }
    finally { this.isBusy = false; btn.textContent = 'Continuar: equipamentos ↗'; this.updateNextDate(); }
  }
  changePlayers(delta) {
    this.count = Math.min(10, Math.max(this.minPlayers, this.count + delta));
    while (this.selections.length < this.count) this.selections.push('');
    this.selections = this.selections.slice(0, this.count);
    this.renderPlayers();
  }
  renderPlayers() {
    this.q('#cf-player-count').textContent = this.count;
    this.q('#cf-minus-player').disabled = this.count <= this.minPlayers;
    this.q('#cf-count-constraint').textContent = `Mínimo ${this.minPlayers} · máximo 10`;
    this.q('#cf-plus-player').disabled = this.count >= 10;
    const equipment = this.availableEquipment || [];
    const cards = this.selections.slice(0, this.count).map((selected, index) => {
      const choices = equipment.map(eq => {
        const usedByOthers = this.selections.slice(0, this.count).filter((id, i) => i !== index && id === eq.id).length;
        const free = Math.max(0, Number(eq.units_free) || 0);
        const soldOut = usedByOthers >= free && selected !== eq.id;
        return `<option value="${escape(eq.id)}" ${selected === eq.id ? 'selected' : ''} ${soldOut ? 'disabled' : ''}>${escape(eq.name)} · ${escape(money(eq.price))}${soldOut ? ' · ESGOTADO' : free <= 2 ? ` · ${free} unidade(s)` : ''}</option>`;
      }).join('');
      return `<label class="cf-equipment-item"><span>Jogador ${index + 1}</span><select data-player="${index}" aria-label="Equipamento do jogador ${index + 1}"><option value="">Equipamento próprio / sem aluguel</option>${choices}</select></label>`;
    });
    this.q('#cf-player-equipment').innerHTML = cards.join('');
  }
  changeEquipment(event) {
    const select = event.target.closest('[data-player]'); if (!select) return;
    const index = Number(select.dataset.player), id = select.value;
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return;
    if (id) {
      const eq = this.availableEquipment?.find(item => item.id === id);
      const otherCount = this.selections.filter((choice, i) => i !== index && choice === id).length;
      if (!eq || otherCount >= Math.max(0, Number(eq.units_free) || 0)) {
        this.setError('cf-step2-alert', 'Este equipamento está indisponível para a quantidade selecionada.');
        this.renderPlayers(); return;
      }
    }
    this.selections[index] = id; this.setError('cf-step2-alert', ''); this.renderPlayers();
  }
  renderExtras() {
    for (const name of ['accessories', 'ammo']) {
      const products = this.catalog[name];
      const quantities = name === 'accessories' ? this.accessoriesQty : this.ammoQty;
      this.q(`#cf-${name}`).innerHTML = products.length ? products.map(item => {
        const qty = quantities[item.id] || 0;
        return `<div class="cf-extra-item"><span><strong>${escape(item.name)}</strong><small>${escape(money(item.price))}</small></span><div class="cf-counter cf-counter-small"><button type="button" data-extra="${escape(item.id)}" data-delta="-1" ${qty === 0 ? 'disabled' : ''} aria-label="Diminuir ${escape(item.name)}">−</button><output>${qty}</output><button type="button" data-extra="${escape(item.id)}" data-delta="1" ${qty >= 10 ? 'disabled' : ''} aria-label="Aumentar ${escape(item.name)}">+</button></div></div>`;
      }).join('') : '<p class="cf-muted">Nenhum item cadastrado.</p>';
    }
  }
  changeExtra(event, name) {
    const button = event.target.closest('[data-extra]'); if (!button) return;
    const item = this.catalog[name].find(it => it.id === button.dataset.extra);
    if (!item) return;
    const quantities = name === 'accessories' ? this.accessoriesQty : this.ammoQty;
    quantities[item.id] = nonnegativeQty((quantities[item.id] || 0) + Number(button.dataset.delta));
    this.renderExtras();
  }
  currentPayload() {
    const form = this.q('#cf-reservation-form');
    return buildReservationPayload({
      date: this.selectedDate, period: this.period, count: this.count,
      selections: this.selections, accessories: this.accessoriesQty, ammo: this.ammoQty,
      name: form.elements.customer_name.value.trim(), whatsapp: form.elements.customer_whatsapp.value.trim(),
      notes: form.elements.notes.value.trim()
    });
  }
  async goToReview() {
    if (this.isBusy) return;
    this.setError('cf-step2-alert', ''); this.isBusy = true;
    const btn = this.q('#cf-to-review'); btn.disabled = true; btn.textContent = 'Calculando…';
    try {
      // Consulta estoque mais uma vez, para evitar seleção com disponibilidade obsoleta.
      if (!(await this.loadEquipmentAvailability())) return;
      const counts = new Map(aggregateEquipment(this.selections).map(s => [s.id, s.qty]));
      for (const [id, qty] of counts) {
        const eq = this.availableEquipment.find(item => item.id === id);
        if (!eq || qty > Number(eq.units_free)) throw new Error('A disponibilidade de equipamentos mudou. Ajuste sua seleção.');
      }
      const preview = await this.api('/reservations/preview', { method: 'POST', body: JSON.stringify(this.currentPayload()) });
      if (!preview || typeof preview.total !== 'number') throw new Error('O resumo de preços retornou incompleto.');
      this.preview = preview; this.renderPreview(); this.setStep(3);
    } catch (error) { this.setError('cf-step2-alert', error.message); this.renderPlayers(); }
    finally { this.isBusy = false; btn.disabled = false; btn.textContent = 'Ver valores e revisar ↗'; }
  }
  renderPreview() {
    const p = this.preview || {};
    const period = this.periods.find(item => item.id === this.period) || {};
    const rows = [
      ['Data', formatDate(this.selectedDate)], ['Turno', `${period.label || this.period} · ${period.time || ''}`],
      ['Jogadores', String(this.count)], ['Entradas', money(p.entry_total)]
    ];
    for (const kind of ['equipment_details', 'accessory_details', 'ammo_details']) {
      for (const line of p[kind] || []) rows.push([`${line.qty}× ${line.name}`, money(line.total)]);
    }
    const lines = rows.map(([label, value]) => `<div><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join('');
    this.q('#cf-preview').innerHTML = `${lines}<div class="cf-total"><span>VALOR TOTAL</span><strong>${escape(money(p.total))}</strong></div><div class="cf-deposit"><span>Sinal (${escape(p.deposit_percent)}%)</span><strong>${escape(money(p.deposit_amount))}</strong></div><div><span>Restante no dia</span><strong>${escape(money(p.remaining))}</strong></div>`;
  }
  async confirm() {
    if (this.isBusy || this.step !== 3) return;
    const form = this.q('#cf-reservation-form');
    const name = form.elements.customer_name.value.trim();
    const phone = form.elements.customer_whatsapp.value.trim();
    this.setError('cf-step3-alert', '');
    if (!name || !validPhone(phone) || !form.elements.contact_consent.checked || !form.elements.adult_responsible.checked) {
      this.setError('cf-step3-alert', 'Informe nome, WhatsApp válido com DDD e confirme ser responsável maior de idade e o consentimento.'); return;
    }
    this.isBusy = true;
    const btn = this.q('#cf-confirm'); btn.disabled = true; btn.textContent = 'Enviando solicitação…';
    try {
      // Confirmação e estoque são validados NOVAMENTE pelo backend. Não tratar prévia como reserva.
      this.reservation = await this.api('/reservations', { method: 'POST', body: JSON.stringify({ ...this.currentPayload(), responsible_adult: true }) });
      this.renderSuccess();
    } catch (error) { this.setError('cf-step3-alert', error.message); }
    finally { this.isBusy = false; btn.disabled = false; btn.textContent = 'Enviar solicitação ↗'; }
  }
  renderSuccess() {
    const r = this.reservation;
    if (!r?.id) return;
    this.q('#cf-closed-form').hidden = true;
    this.q('#cf-success').hidden = false;
    this.q('#cf-success .cf-stage-title')?.remove();
    const pixKey = this.settings?.pix_key;
    this.q('#cf-confirmation').innerHTML = `<div class="cf-summary"><div><span>Protocolo</span><strong>${escape(r.id)}</strong></div><div><span>Data e horário</span><strong>${escape(`${formatDate(r.date)} · ${r.period_label || this.period}`)}</strong></div><div><span>Total</span><strong>${escape(money(r.total))}</strong></div><div class="cf-deposit"><span>Sinal previsto</span><strong>${escape(money(r.deposit_amount))}</strong></div>${pixKey ? `<div><span>Chave PIX da organização</span><strong class="cf-break">${escape(pixKey)}</strong></div>` : ''}<div><span>Situação</span><strong>Aguardando confirmação</strong></div></div>${this.settings?.pix_instructions ? `<p class="cf-help">${escape(this.settings.pix_instructions)}</p>` : ''}`;
    this.q('#cf-copy-pix').hidden = !pixKey;
    const wa = this.q('#cf-success-whatsapp');
    const phone = String(this.settings?.whatsapp_number || this.config.whatsapp || '').replace(/\D/g, '');
    if (phone) {
      const msg = `Olá! Enviei uma solicitação ao Campo Ferrari. Protocolo: ${r.id}. Data: ${formatDate(r.date)}. Turno: ${r.period_label || this.period}. Jogadores: ${r.player_count}. Total: ${money(r.total)}. Sinal: ${money(r.deposit_amount)}. Gostaria de confirmar os próximos passos.`;
      wa.href = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`; wa.hidden = false;
    } else { wa.hidden = true; wa.removeAttribute('href'); }
  }
  async copyPix() {
    const btn = this.q('#cf-copy-pix');
    try { await navigator.clipboard.writeText(this.settings.pix_key); btn.textContent = 'Chave copiada ✓'; }
    catch { btn.textContent = 'Selecione e copie a chave exibida acima'; }
  }
  resetClosed() {
    this.clearSchedule();
    this.count = Math.max(6, this.minPlayers); this.selections = Array(this.count).fill(''); this.accessoriesQty = {}; this.ammoQty = {};
    this.preview = null; this.reservation = null;
    this.events = []; this.activeEvent = null;
    this.q('#cf-reservation-form').reset(); this.q('#cf-copy-pix').textContent = 'Copiar chave PIX';
    this.q('#cf-selected-date').textContent = 'Escolha uma data';
    this.setError('cf-step1-alert', ''); this.setError('cf-step2-alert', ''); this.setError('cf-step3-alert', '');
    this.renderCalendar(); this.renderPeriods(); this.renderPlayers(); this.renderExtras(); this.updateNextDate(); this.setStep(1);
    // O último turno reservado pode ter ficado ocupado no servidor.
    this.loadMonth();
  }
  renderEvents(events) {
    // A lista pública usa nomes abreviados, somente após autorização.
    // Nunca incluímos contatos, observações ou nomes completos.
    this.events = events.filter(e => e.date >= todayLocal());
    const list = this.q('#cf-events-list');
    list.innerHTML = this.events.length ? this.events.map(e => {
      const remaining = e.remaining_places;
      const seats = remaining === null ? 'Vagas a confirmar' : remaining === 0 ? 'Lista lotada' : `${remaining} vaga${remaining === 1 ? '' : 's'} ${remaining === 1 ? 'disponível' : 'disponíveis'}`;
      const disabled = !e.can_register;
      const subtitle = e.period ? `${e.period_label} · ${e.period_time}` : (e.time_info || 'Horário a confirmar');
      const participants = Array.isArray(e.participants) ? e.participants : null;
      const roster = `<section class="cf-event-roster" aria-label="Quem está na lista"><h6>Quem está na lista</h6>${participants === null ? '<p>A lista de participantes está temporariamente indisponível.</p>' : participants.length ? `<ul>${participants.map(p => {
        const count = Math.max(1, Number(p.people_count) || 1);
        const companions = Array.isArray(p.companion_names) ? p.companion_names.slice(0, count - 1) : [];
        const names = companions.length
          ? `<div class="cf-group-people"><strong>Integrantes do grupo</strong><ol><li>${escape(p.display_name || 'Responsável')} <em>(responsável)</em></li>${companions.map(n => `<li>${escape(n)}</li>`).join('')}</ol></div>`
          : (count > 1 ? '<small class="cf-group-private">Nomes dos acompanhantes não autorizados para exibição.</small>' : '');
        return `<li><span>${escape(p.display_name || 'Participante')}</span><small>${count === 1 ? '1 participante' : `${count} participantes no grupo`}</small>${names}</li>`;
      }).join('')}</ul><p>São exibidos somente nomes abreviados com autorização. A participação será confirmada pela equipe.</p>` : '<p>Ninguém entrou nesta lista ainda. Seja o primeiro!</p>'}</section>`;
      return `<article class="cf-event ${disabled ? 'is-full' : ''}"><div class="cf-event-info"><strong>${escape(e.title || 'Lista aberta')}</strong><small>${escape(formatDate(e.date))} · ${escape(subtitle)}</small>${e.notes ? `<p>${escape(e.notes)}</p>` : ''}<span class="cf-event-seats">${escape(seats)} · ${Number(e.registered_people) || 0} inscrito(s)</span></div><button type="button" data-open-event-id="${escape(e.id)}" ${disabled ? 'disabled' : ''}>${e.is_full ? 'Esgotado' : e.has_started ? 'Inscrições encerradas' : 'Tenho interesse ↗'}</button>${roster}</article>`;
    }).join('') : '<p class="cf-empty-events">Nenhuma lista aberta disponível no momento. Novos jogos serão exibidos aqui quando o administrador publicar.</p>';
    // Caso as vagas tenham acabado enquanto alguém preenchia, feche o formulário.
    if (this.activeEvent) {
      const current = this.events.find(e => e.id === this.activeEvent.id);
      if (!current || !current.can_register) this.showOpenEvents();
      else { this.activeEvent = current; this.renderSelectedEvent(); }
    }
  }
  async loadOpenEvents() {
    const button=this.q('#cf-open-reload'); button.disabled=true;
    try { this.renderEvents(await this.api('/open-events')); }
    catch(err) { this.q('#cf-events-list').innerHTML = `<p class="cf-muted">${escape(err.message)} Tente atualizar novamente.</p>`; }
    finally { button.disabled=false; }
  }
  showOpenEvents() {
    this.activeEvent=null;
    this.q('#cf-open-form').hidden=true;
    this.q('#cf-open-form').reset();
    this.renderOpenCompanions();
    this.setError('cf-open-alert', '');
  }
  selectOpenEvent(id) {
    const event=this.events.find(e => e.id === id && e.can_register);
    if (!event) { this.showOpenEvents(); return; }
    this.activeEvent=event;
    this.q('#cf-open-success').hidden=true;
    this.q('#cf-open-form').hidden=false;
    this.renderSelectedEvent();
    this.renderOpenCompanions();
    this.q('#cf-open-form').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  renderSelectedEvent() {
    const event=this.activeEvent;
    if (!event) return;
    const subtitle=event.period ? `${event.period_label} · ${event.period_time}` : (event.time_info || 'Horário a confirmar');
    const left=event.remaining_places===null?'Vagas a confirmar':`${event.remaining_places} vaga(s) restante(s)`;
    this.q('#cf-open-selected').innerHTML = `<span>EVENTO SELECIONADO</span><strong>${escape(event.title)}</strong><small>${escape(formatDate(event.date))} · ${escape(subtitle)} · ${escape(left)}</small>`;
    const input=this.q('#cf-open-form [name="people_count"]');
    input.max=String(event.remaining_places===null?100:Math.min(100,event.remaining_places));
    if (Number(input.value)>Number(input.max)) input.value=input.max;
    this.renderOpenCompanions();
  }
  /** Gera um campo obrigatório para cada acompanhante; o responsável é a pessoa 1. */
  renderOpenCompanions() {
    const form=this.q('#cf-open-form');
    const raw=Number(form.elements.people_count.value);
    const count=Number.isInteger(raw) && raw>=1 && raw<=100 ? raw : 1;
    const container=this.q('#cf-open-companions');
    const fields=this.q('#cf-open-companions-fields');
    const previous=[...fields.querySelectorAll('[data-companion-name]')].map(input=>input.value);
    const extra=count-1;
    container.hidden=extra===0;
    if (!extra) { fields.replaceChildren(); return; }
    // Atualiza só os campos afetados para não apagar nomes já digitados.
    if (fields.children.length===extra) return;
    const fragment=document.createDocumentFragment();
    for(let i=0;i<extra;i++){
      const label=document.createElement('label');
      label.textContent=`Participante ${i+2} (nome obrigatório)`;
      const input=document.createElement('input');
      input.type='text'; input.name='participant_names[]'; input.maxLength=120;
      input.required=true; input.autocomplete='off';
      input.dataset.companionName=String(i+2);
      input.placeholder=`Nome do participante ${i+2}`;
      input.value=previous[i]??'';
      label.append(input); fragment.append(label);
    }
    fields.replaceChildren(fragment);
  }
  async joinOpenList() {
    if (this.isBusy) return;
    const event=this.activeEvent;
    if (!event || !event.can_register) {
      this.setError('cf-open-alert','Escolha primeiro um evento disponível.'); return;
    }
    const form=this.q('#cf-open-form'), els=form.elements;
    const name=els.name.value.trim(), phone=els.whatsapp.value.trim();
    const count=Number(els.people_count.value);
    this.renderOpenCompanions();
    const nameInputs=[...form.querySelectorAll('[data-companion-name]')];
    const companionNames=nameInputs.map(input=>input.value.trim());
    this.setError('cf-open-alert','');
    if (!name || !validPhone(phone) || !Number.isInteger(count) || count < 1 || count > 100 ||
        (event.remaining_places!==null && count>event.remaining_places) ||
        !els.contact_consent.checked || !els.adult_responsible.checked || !els.public_names_consent.checked) {
      this.setError('cf-open-alert','Confira nome, WhatsApp, número de participantes, vagas e autorização do responsável.');return;
    }
    if (companionNames.length!==count-1 || companionNames.some(name=>name.length<2 || name.length>120)) {
      this.setError('cf-open-alert',`Preencha o nome de todos os ${count-1} participantes adicionais antes de enviar a inscrição.`);
      const missing=nameInputs.find(input=>input.value.trim().length<2);
      missing?.focus(); return;
    }
    this.isBusy=true;
    const btn=this.q('#cf-submit-open');btn.disabled=true;btn.textContent='Enviando…';
    try {
      await this.api('/open-list',{
        method:'POST',body:JSON.stringify({
          event_id:event.id,name,whatsapp:phone,people_count:count,
          participant_names:companionNames,
          public_names_consent:els.public_names_consent.checked,
          responsible_adult:true,notes:els.notes.value.trim()
        })
      });
      this.q('#cf-open-success-message').textContent=`Sua inscrição para ${event.title}, em ${formatDate(event.date)} (${event.period_label}), foi registrada para ${count} participante(s). A equipe entrará em contato pelo WhatsApp para confirmar.`;
      form.hidden=true;this.q('#cf-open-success').hidden=false;
      this.activeEvent=null;
      await this.loadOpenEvents();
    } catch(error) {
      this.setError('cf-open-alert',error.message);
      // Um cadastro concorrente pode ter preenchido as últimas vagas.
      if (error.message.includes('vagas')) await this.loadOpenEvents();
    } finally {this.isBusy=false;btn.disabled=false;btn.textContent='Enviar inscrição ↗';}
  }
}
