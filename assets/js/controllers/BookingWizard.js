import { whatsAppHref, normalizeBRWhatsApp } from '../services/WhatsAppBooking.js?v=20261027-pagamento-v11-10';
/** Reservas em JavaScript com API PHP 8 + MySQL no Laragon. */
const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const escape = (text) => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (value) => moneyFormatter.format(Number(value) || 0);
export const todayLocal = (date = new Date()) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
export const formatDate = (day) => /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : day;
// Mesma validação usada pelos links wa.me; aceita +55, 55 e DDD sem código do país.
export const validPhone = (phone) => normalizeBRWhatsApp(phone) !== null;
export const nonnegativeQty = (value, limit = 10) => Math.max(0, Math.min(limit, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0));
/** Os jogadores usam uma unidade da reserva de máscaras, antes das unidades extras. */
export const isExtraMaskAccessory = (name) => /\bmascara\s+extras?\b/i.test(String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
export const availableExtraUnits = (item, available, players) => {
  const free = Math.max(0, Math.trunc(Number(available?.units_free) || 0));
  return isExtraMaskAccessory(item?.name) ? Math.max(0, free - Math.max(0, Math.trunc(Number(players) || 0))) : free;
};
export const aggregateEquipment = (selected) => {
  const counts = new Map();
  for (const id of selected) if (id) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts].map(([id, qty]) => ({ id, qty }));
};
function currentPeriodDetails(all, selected, labels) {
  return selected.map(id => {
    const item = all.find(p => p.id === id);
    return `${labels[id]}${item?.time ? ` (${item.time})` : ''}`;
  }).join(' + ');
}

export function buildReservationPayload({date, periods, period, count, selections, playerNames = [], accessories, ammo, name, whatsapp, notes}) {
  const chosen = Array.isArray(periods) && periods.length ? periods : (period ? [period] : []);
  if (!date || !chosen.length || !Number.isInteger(count) || count < 4 || count > 10) throw new Error('Escolha uma data, pelo menos um turno e grupo de 4 a 10 pessoas.');
  const quantities = obj => Object.entries(obj).filter(([, qty]) => qty > 0).map(([id, qty]) => ({ id, qty }));
  return {
    modality: 'lista_fechada', date, period: chosen[0], periods: chosen, player_count: count,
    players: selections.slice(0, count).map((id, index) => ({equipment_id: id || null, name: String(playerNames[index] || '').trim()})),
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
    this.selectedDate = ''; this.period = ''; this.selectedPeriods = []; this.count = 4; this.minPlayers = 4;
    this.selections = Array(4).fill(''); this.playerNames = Array(4).fill(''); this.accessoriesQty = {}; this.ammoQty = {};
    this.catalog = { equipment: [], accessories: [], ammo: [] };
    this.settings = null; this.allowMultiplePeriods = true; this.allowMultiplePeriodsPrivate = true; this.availableEquipment = null; this.availableAccessories = null; this.days = []; this.periods = [];
    this.preview = null; this.reservation = null;
    this.events = []; this.activeEvent = null;
    this.isBusy = false; this.monthToken = 0; this.periodToken = 0; this.equipmentToken = 0;
    // Agenda independente da Lista Fechada. Nunca assume disponibilidade quando a API falha.
    this.privateYear = d.getFullYear(); this.privateMonth = d.getMonth() + 1;
    this.privateDays = []; this.privatePeriods = [];
    this.privateDate = ''; this.privateSelectedPeriods = [];
    this.privateMonthToken = 0; this.privatePeriodToken = 0;
    this.privateCalendarInitialized = false;

  }
  q(selector) { return this.root.querySelector(selector); }
  /** No celular a seleção de um dia recolhe a grade, mantendo um botão para alterá-lo. */
  setCalendarCompact(kind, active) {
    const privateEvent = kind === 'private';
    const container = this.q(privateEvent ? '.cf-private-date-layout' : '#cf-closed .cf-date-layout');
    const label = this.q(privateEvent ? '#cf-private-compact-date' : '#cf-closed-compact-date');
    const toggle = this.q(privateEvent ? '#cf-private-reopen-calendar' : '#cf-closed-edit-date');
    const selected = privateEvent ? this.privateDate : this.selectedDate;
    if (!container || !label || !toggle) return;
    const collapsed = Boolean(active && selected);
    label.textContent = selected ? formatDate(selected) : 'Escolha uma data';
    container.classList.toggle('cf-date-layout-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }
  /** Deslocamento seguro abaixo da barra fixa, com respeito à preferência de movimento reduzido. */
  scrollToBookingElement(element) {
    if (!element || !window.matchMedia?.('(max-width: 759.98px)').matches) return;
    window.requestAnimationFrame(() => {
      if (!element.isConnected || element.closest('[hidden]')) return;
      const headerHeight = document.querySelector('.site-header')?.getBoundingClientRect().height || 0;
      const top = element.getBoundingClientRect().top + window.scrollY - headerHeight - 14;
      window.scrollTo({
        top: Math.max(0, top),
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      });
    });
  }
  // As duas modalidades consultam regras independentes da API pública.
  // Para instalações sem migração, usa-se a preferência antiga como fallback.
  applyPeriodPolicy() {
    const closedMultiple = this.allowMultiplePeriods;
    const privateMultiple = this.allowMultiplePeriodsPrivate;
    for(const [selector,multiple] of [
      ['.cf-closed-multiselect-hint',closedMultiple],
      ['.cf-private-multiselect-hint',privateMultiple]
    ]) {
      const hint=this.q(selector);
      if(hint)hint.textContent=multiple
        ? 'Selecione quantos turnos precisar. Ex.: Manhã + Tarde ou Manhã + Noite.'
        : 'Escolha um único turno disponível. A seleção múltipla está desativada pela organização.';
    }
    for(const [selector,multiple,enabledText,disabledText] of [
      ['.cf-closed-intro p',closedMultiple,'Reúna de 4 a 10 jogadores, escolha a data e os turnos disponíveis e prepare sua equipe para entrar em campo.','Reúna de 4 a 10 jogadores, escolha a data e um turno disponível e prepare sua equipe para entrar em campo.'],
      ['#cf-step-1 > .cf-stage-title p',closedMultiple,'Selecione uma data e um ou mais turnos disponíveis.','Selecione uma data e um turno disponível.'],
      ['#cf-private-calendar-stage > .cf-stage-title p',privateMultiple,'Selecione uma data e combine um ou mais turnos disponíveis (manhã, tarde e noite).','Selecione uma data e um turno disponível (manhã, tarde ou noite).']
    ]) {
      const description=this.q(selector);
      if(description)description.textContent=multiple?enabledText:disabledText;
    }
    for(const [selector,multiple] of [['#cf-periods',closedMultiple],['#cf-private-periods',privateMultiple]]){
      const group=this.q(selector);
      if(group)group.setAttribute('aria-label',multiple?'Selecione um ou mais turnos':'Selecione apenas um turno');
    }
    if(!closedMultiple && this.selectedPeriods.length>1){
      this.selectedPeriods=this.selectedPeriods.slice(0,1);
      this.availableEquipment=null;this.availableAccessories=null;this.accessoriesQty={};this.preview=null;
    }
    if(!privateMultiple && this.privateSelectedPeriods.length>1)this.privateSelectedPeriods=this.privateSelectedPeriods.slice(0,1);
    this.renderPeriods();this.renderPrivatePeriods();
  }
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
    this.q('#cf-closed-edit-date').addEventListener('click', () => {
      this.setCalendarCompact('closed', false);
      this.scrollToBookingElement(this.q('#cf-closed .cf-calendar-wrap'));
    });
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
    this.q('#cf-period-combinations').addEventListener('click', event => {
      const button = event.target.closest('[data-closed-combination]');
      if (button && !button.disabled) this.selectClosedCombination(button.dataset.closedCombination ? button.dataset.closedCombination.split(',') : []);
    });
    this.q('#cf-to-equipment').addEventListener('click', () => this.goToEquipment());
    this.q('#cf-back-date').addEventListener('click', () => { this.setStep(1); this.scrollToBookingElement(this.q('#cf-step-1')); });
    this.q('#cf-minus-player').addEventListener('click', () => this.changePlayers(-1));
    this.q('#cf-plus-player').addEventListener('click', () => this.changePlayers(1));
    this.q('#cf-player-equipment').addEventListener('change', event => this.changeEquipment(event));
    this.q('#cf-player-equipment').addEventListener('input', event => {
      const input = event.target.closest('[data-player-name]');
      if (!input) return;
      const i = Number(input.dataset.playerName);
      if (Number.isInteger(i) && i >= 0 && i < this.count) this.playerNames[i] = input.value;
    });
    for (const section of ['accessories', 'ammo']) {
      this.q(`#cf-${section}`).addEventListener('click', event => this.changeExtra(event, section));
    }
    this.q('#cf-to-review').addEventListener('click', () => this.goToReview());
    this.q('#cf-back-equipment').addEventListener('click', () => { this.setStep(2); this.scrollToBookingElement(this.q('#cf-step-2')); });
    this.q('#cf-reservation-form').addEventListener('submit', event => { event.preventDefault(); this.confirm(); });
    // Evento fechado: apenas consulta personalizada via WhatsApp; não grava reserva.
    const privateForm = this.q('#cf-private-event-form');
    if (privateForm) {
      this.q('#cf-private-prev-month').addEventListener('click', () => this.changePrivateMonth(-1));
      this.q('#cf-private-next-month').addEventListener('click', () => this.changePrivateMonth(1));
      this.q('#cf-private-reopen-calendar').addEventListener('click', () => {
        this.setCalendarCompact('private', false);
        this.scrollToBookingElement(this.q('#cf-private-event .cf-calendar-wrap'));
      });
      this.q('#cf-private-calendar-days').addEventListener('click', event => {
        const button = event.target.closest('[data-private-date]');
        if (button && !button.disabled) this.selectPrivateDate(button.dataset.privateDate);
      });
      this.q('#cf-private-periods').addEventListener('click', event => {
        const button = event.target.closest('[data-private-period]');
        if (button && !button.disabled) this.selectPrivatePeriod(button.dataset.privatePeriod);
      });
      // Atalhos para escolher combinações. Só habilitados se TODOS os turnos estiverem livres.
      this.q('#cf-private-combinations').addEventListener('click', event => {
        const button = event.target.closest('[data-private-combination]');
        if (!button || button.disabled) return;
        const combo = button.dataset.privateCombination;
        this.selectPrivateCombination(combo ? combo.split(',') : []);
      });
      this.q('#cf-private-to-details').addEventListener('click', () => this.advancePrivateDetails());
      this.q('#cf-private-edit-date').addEventListener('click', () => this.showPrivateCalendar());
      this.q('#cf-private-back-calendar').addEventListener('click', () => this.showPrivateCalendar());
      privateForm.addEventListener('submit', event => {
        event.preventDefault();
        this.requestPrivateEvent(privateForm);
      });
      const successDialog = document.getElementById('cf-private-success-dialog');
      if (successDialog) {
        const closeSuccess = () => {
          if (successDialog.classList.contains('cf-private-success-fallback')) {
            successDialog.removeAttribute('open');
            successDialog.classList.remove('cf-private-success-fallback');
          } else if (typeof successDialog.close === 'function' && successDialog.open) {
            successDialog.close();
          }
        };
        successDialog.querySelector('[data-close-private-success]')?.addEventListener('click', closeSuccess);
        successDialog.addEventListener('click', event => {
          if (event.target === successDialog) closeSuccess();
        });
      }
    }
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
    this.q('#cf-edit-schedule').addEventListener('click', () => { this.setStep(1); this.scrollToBookingElement(this.q('#cf-step-1')); });
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
    if (settings.status === 'fulfilled') {
      this.settings = settings.value;
      this.allowMultiplePeriods = Number(this.settings?.allow_multiple_periods_closed ?? this.settings?.allow_multiple_periods ?? 1) === 1;
      this.allowMultiplePeriodsPrivate = Number(this.settings?.allow_multiple_periods_private ?? this.settings?.allow_multiple_periods ?? 1) === 1;
      this.applyPeriodPolicy();
    }
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
    if (!['closed', 'open', 'private-event'].includes(mode)) return;
    this.mode = mode;
    this.q('#cf-closed').hidden = mode !== 'closed';
    this.q('#cf-open').hidden = mode !== 'open';
    this.q('#cf-private-event').hidden = mode !== 'private-event';
    if (mode === 'private-event' && !this.privateCalendarInitialized) {
      this.privateCalendarInitialized = true;
      this.loadPrivateMonth();
    }
    this.root.querySelectorAll('[data-mode]').forEach(btn => {
      const active = btn.dataset.mode === mode; btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }
  // V11.6: calendário do Evento Fechado, com layout equivalente à Lista Fechada.
  resetPrivateChoice() {
    this.privateDate = ''; this.privateSelectedPeriods = []; this.privatePeriods = [];
    this.setCalendarCompact('private', false);
    this.privatePeriodToken++;
    this.q('#cf-private-selected-date').textContent = 'Escolha uma data';
    this.q('#cf-private-event-date').value = '';
    this.q('#cf-private-event-period').value = '';
    this.q('#cf-private-selected-periods').textContent = this.allowMultiplePeriodsPrivate ? 'Escolha um ou mais turnos disponíveis.' : 'Escolha apenas um turno disponível.';
    this.renderPrivateCombinations();
    this.q('#cf-private-to-details').disabled = true;
    this.q('#cf-private-periods').innerHTML = '<p class="cf-muted">Selecione uma data no calendário para ver os turnos.</p>';
    this.setError('cf-private-period-error', '');
  }
  changePrivateMonth(delta) {
    const next = new Date(this.privateYear, this.privateMonth - 1 + delta, 1);
    const now = new Date();
    if (next < new Date(now.getFullYear(), now.getMonth(), 1)) return;
    this.privateYear = next.getFullYear(); this.privateMonth = next.getMonth() + 1;
    this.resetPrivateChoice(); this.loadPrivateMonth();
  }
  async loadPrivateMonth() {
    const token = ++this.privateMonthToken;
    this.privateDays = [];
    this.q('#cf-private-month-label').textContent = monthFormatter.format(new Date(this.privateYear, this.privateMonth - 1, 1));
    this.q('#cf-private-calendar-days').innerHTML = '<p class="cf-loading">Consultando calendário…</p>';
    this.setError('cf-private-calendar-error', '');
    const now = new Date();
    this.q('#cf-private-prev-month').disabled = this.privateYear === now.getFullYear() && this.privateMonth === now.getMonth() + 1;
    try {
      const dates = await this.api(`/availability?year=${this.privateYear}&month=${this.privateMonth}`);
      if (token !== this.privateMonthToken) return;
      if (!Array.isArray(dates)) throw new Error('O sistema retornou um calendário inválido.');
      this.privateDays = dates;
      if (this.privateDate && !dates.some(d => d.date === this.privateDate && d.status === 'available')) this.resetPrivateChoice();
      this.renderPrivateCalendar();
    } catch (error) {
      if (token !== this.privateMonthToken) return;
      this.renderPrivateCalendar();
      this.setError('cf-private-calendar-error', error.message);
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'cf-retry-btn'; retry.textContent = 'Tentar novamente ↻';
      retry.addEventListener('click', () => this.loadPrivateMonth());
      this.q('#cf-private-calendar-error').append(retry);
    }
  }
  renderPrivateCalendar() {
    const grid = this.q('#cf-private-calendar-days');
    const beginning = new Date(this.privateYear, this.privateMonth - 1, 1).getDay();
    const cells = Array.from({ length: beginning }, () => '<span class="cf-calendar-empty" aria-hidden="true"></span>');
    for (const day of this.privateDays) {
      const past = day.date < todayLocal();
      const free = day.status === 'available' && !past;
      const opened = Boolean(day.has_open_event || day.status === 'open_event');
      const selected = this.privateDate === day.date;
      const label = `${formatDate(day.date)} — ${free ? 'Disponível para consulta' : 'Indisponível'}${opened ? ', há lista aberta nesse dia' : ''}`;
      cells.push(`<button type="button" class="cf-calendar-day ${free ? 'available' : 'taken'} ${opened ? 'has-open-event' : ''} ${selected ? 'is-selected' : ''}" data-private-date="${escape(day.date)}" aria-label="${escape(label)}" title="${escape(label)}" aria-pressed="${selected}" ${free ? '' : 'disabled'}>${escape(Number(day.date.slice(-2)))}${opened ? '<small>ABERTA</small>' : '<i aria-hidden="true"></i>'}</button>`);
    }
    grid.innerHTML = cells.length ? cells.join('') : '<p class="cf-muted cf-private-empty">Não foi possível consultar os dias deste mês.</p>';
  }
  async selectPrivateDate(date) {
    if (date < todayLocal() || !this.privateDays.some(d => d.date === date && d.status === 'available')) return;
    this.resetPrivateChoice();
    this.privateDate = date;
    this.q('#cf-private-selected-date').textContent = formatDate(date);
    this.q('#cf-private-event-date').value = date;
    this.renderPrivateCalendar();
    this.setCalendarCompact('private', true);
    this.scrollToBookingElement(this.q('#cf-private-event .cf-period-panel'));
    await this.loadPrivatePeriods(date);
  }
  async loadPrivatePeriods(date = this.privateDate) {
    if (!date || date !== this.privateDate) return;
    const token = ++this.privatePeriodToken;
    this.q('#cf-private-periods').innerHTML = '<p class="cf-muted">Consultando turnos…</p>';
    this.setError('cf-private-period-error', '');
    try {
      const data = await this.api(`/day-periods?date=${encodeURIComponent(date)}`);
      if (token !== this.privatePeriodToken || date !== this.privateDate) return;
      if (!Array.isArray(data)) throw new Error('Não foi possível consultar os turnos.');
      this.privatePeriods = data;
      // Mantém apenas períodos ainda disponíveis, caso a agenda tenha mudado.
      const stillAvailable = new Set(data.filter(p => p.status === 'available').map(p => p.id));
      const previous = this.privateSelectedPeriods.length;
      this.privateSelectedPeriods = this.privateSelectedPeriods.filter(id => stillAvailable.has(id));
      this.syncPrivatePeriodSelection();
      if (this.privateSelectedPeriods.length < previous) {
        this.setError('cf-private-period-error', 'Alguns turnos deixaram de estar disponíveis. Revise sua seleção.');
      }
      this.renderPrivatePeriods();
    } catch (error) {
      if (token !== this.privatePeriodToken || date !== this.privateDate) return;
      this.privatePeriods = []; this.privateSelectedPeriods = [];
      this.syncPrivatePeriodSelection();
      this.q('#cf-private-to-details').disabled = true;
      this.q('#cf-private-periods').innerHTML = '<p class="cf-muted">Os turnos estão indisponíveis para consulta.</p>';
      this.setError('cf-private-period-error', error.message);
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'cf-retry-btn'; retry.textContent = 'Tentar novamente ↻';
      retry.addEventListener('click', () => this.loadPrivatePeriods(date));
      this.q('#cf-private-period-error').append(retry);
    }
  }
  // Os turnos do evento privativo são uma seleção múltipla (não uma reserva automática).
  syncPrivatePeriodSelection() {
    const ordered = this.privatePeriods.filter(p => this.privateSelectedPeriods.includes(p.id));
    this.privateSelectedPeriods = ordered.map(p => p.id);
    if(!this.allowMultiplePeriodsPrivate)this.privateSelectedPeriods=this.privateSelectedPeriods.slice(0,1);
    this.q('#cf-private-event-period').value = this.privateSelectedPeriods.join(',');
    const visible = this.privatePeriods.filter(p => this.privateSelectedPeriods.includes(p.id));
    const count = visible.length;
    this.q('#cf-private-selected-periods').textContent = count
      ? `${count} ${count === 1 ? 'turno selecionado' : 'turnos selecionados'}: ${visible.map(p => p.label).join(' + ')}`
      : (this.allowMultiplePeriodsPrivate ? 'Escolha um ou mais turnos disponíveis.' : 'Escolha apenas um turno disponível.');
    this.q('#cf-private-to-details').disabled = count === 0;
    this.renderPrivateCombinations();
  }
  /** Atalhos intuitivos para dois ou três turnos, sem ignorar indisponibilidades da API. */
  renderPrivateCombinations() {
    const parent = this.q('#cf-private-combinations');
    if (!parent) return;
    if (!this.allowMultiplePeriodsPrivate || !this.privateDate || !this.privatePeriods.length) {
      parent.innerHTML = '';
      parent.hidden = true;
      return;
    }
    parent.hidden = false;
    const combos = [
      { ids: ['manha', 'tarde'], label: 'Manhã + Tarde' },
      { ids: ['manha', 'noite'], label: 'Manhã + Noite' },
      { ids: ['tarde', 'noite'], label: 'Tarde + Noite' },
      { ids: ['manha', 'tarde', 'noite'], label: 'Todos os turnos' }
    ];
    const free = new Set(this.privatePeriods.filter(p => p.status === 'available').map(p => p.id));
    parent.innerHTML = `<strong>Escolha rápida de turnos</strong><div class="cf-private-combination-buttons">${combos.map(c => {
      const allowed = c.ids.every(id => free.has(id));
      const selected = this.privateSelectedPeriods.length === c.ids.length && c.ids.every(id => this.privateSelectedPeriods.includes(id));
      return `<button type="button" class="cf-private-combination ${selected ? 'is-active' : ''}" data-private-combination="${c.ids.join(',')}" aria-pressed="${selected}" ${allowed ? '' : 'disabled title="Um ou mais turnos indisponíveis"'}>${selected ? '✓ ' : ''}${c.label}</button>`;
    }).join('')}<button type="button" class="cf-private-combination cf-private-combination-clear" data-private-combination="" ${this.privateSelectedPeriods.length ? '' : 'disabled'}>Limpar seleção</button></div>`;
  }
  selectPrivateCombination(ids) {
    if (!this.allowMultiplePeriodsPrivate || !this.privateDate || !Array.isArray(ids)) return;
    const free = new Set(this.privatePeriods.filter(p => p.status === 'available').map(p => p.id));
    if (ids.some(id => !free.has(id)) || new Set(ids).size !== ids.length) return;
    this.privateSelectedPeriods = [...ids];
    this.setError('cf-private-period-error', '');
    this.renderPrivatePeriods();
  }
  renderPrivatePeriods() {
    const parent = this.q('#cf-private-periods');
    if (!this.privateDate) {
      parent.innerHTML = '<p class="cf-muted">Selecione uma data no calendário para ver os turnos.</p>';
      this.syncPrivatePeriodSelection(); return;
    }
    if (!this.privatePeriods.length) {
      parent.innerHTML = '<p class="cf-muted">Nenhum turno disponível nesta data.</p>';
      this.syncPrivatePeriodSelection(); return;
    }
    parent.innerHTML = this.privatePeriods.map(period => {
      const available = period.status === 'available';
      const selected = available && this.privateSelectedPeriods.includes(period.id);
      const status = period.status === 'open_event' ? 'Lista aberta' : period.status === 'taken' ? 'Ocupado' : 'Indisponível';
      const label = `${period.label}: ${period.time}. ${selected ? 'Selecionado' : available ? 'Disponível' : status}`;
      return `<button type="button" class="cf-period ${selected ? 'is-selected' : ''}" data-private-period="${escape(period.id)}" aria-label="${escape(label)}" aria-pressed="${selected}" ${available ? '' : 'disabled'}><span><b>${escape(period.label)}</b><small>${escape(period.time)}</small></span><em>${available ? (selected ? '✓ Escolhido · remover' : '+ Escolher turno') : status}</em></button>`;
    }).join('');
    this.syncPrivatePeriodSelection();
  }
  selectPrivatePeriod(id) {
    if (!this.privatePeriods.some(p => p.id === id && p.status === 'available')) return;
    if (this.privateSelectedPeriods.includes(id)) {
      this.privateSelectedPeriods = this.privateSelectedPeriods.filter(p => p !== id);
    } else {
      this.privateSelectedPeriods = this.allowMultiplePeriodsPrivate ? [...this.privateSelectedPeriods,id] : [id];
    }
    this.setError('cf-private-period-error', '');
    this.renderPrivatePeriods();
  }
  showPrivateCalendar() {
    this.q('#cf-private-calendar-stage').hidden = false;
    this.q('#cf-private-details-stage').hidden = true;
    this.q('#cf-private-step-calendar-label').classList.add('is-active');
    this.q('#cf-private-step-details-label').classList.remove('is-active');
    this.q('#cf-private-event-status').hidden = true;
    this.q('#cf-private-event-manual').hidden = true;
    this.scrollToBookingElement(this.q('#cf-private-calendar-stage .cf-stage-title'));
    // Revalida a data e os turnos ao voltar ao calendário.
    if (this.privateDate) this.loadPrivatePeriods(this.privateDate);
    else this.loadPrivateMonth();
  }
  async advancePrivateDetails() {
    if (!this.privateDate || !this.privateSelectedPeriods.length) return;
    if (!this.allowMultiplePeriodsPrivate && this.privateSelectedPeriods.length > 1) {
      this.setError('cf-private-period-error', 'Escolha apenas um turno.'); return;
    }
    const button = this.q('#cf-private-to-details');
    button.disabled = true; button.textContent = 'Conferindo…';
    try {
      const periods = await this.api(`/day-periods?date=${encodeURIComponent(this.privateDate)}`);
      const available = new Set(Array.isArray(periods) ? periods.filter(p => p.status === 'available').map(p => p.id) : []);
      if (!Array.isArray(periods) || !this.privateSelectedPeriods.every(id => available.has(id))) {
        this.privatePeriods = Array.isArray(periods) ? periods : [];
        this.privateSelectedPeriods = this.privateSelectedPeriods.filter(id => available.has(id));
        this.renderPrivatePeriods();
        this.setError('cf-private-period-error', 'Um ou mais turnos escolhidos não estão disponíveis. Revise os períodos.');
        return;
      }
      this.privatePeriods = periods;
      this.syncPrivatePeriodSelection();
      const chosen = periods.filter(p => this.privateSelectedPeriods.includes(p.id));
      this.q('#cf-private-selection-summary').textContent = `${formatDate(this.privateDate)} · ${chosen.map(p => `${p.label} (${p.time})`).join(' + ')}`;
      this.q('#cf-private-calendar-stage').hidden = true;
      this.q('#cf-private-details-stage').hidden = false;
      this.q('#cf-private-step-calendar-label').classList.remove('is-active');
      this.q('#cf-private-step-details-label').classList.add('is-active');
      this.scrollToBookingElement(this.q('#cf-private-details-stage'));
    } catch (error) {
      this.setError('cf-private-period-error', `Não foi possível conferir os turnos: ${error.message}`);
    } finally {
      button.textContent = 'Continuar: detalhes ↗';
      this.syncPrivatePeriodSelection();
    }
  }
  showPrivateRequestSuccess() {
    const dialog = document.getElementById('cf-private-success-dialog');
    if (!dialog) return;
    // showModal() coloca o aviso em primeiro plano e controla o foco e a tecla Esc.
    try {
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
      } else {
        dialog.classList.add('cf-private-success-fallback');
        dialog.setAttribute('open', '');
      }
    } catch (_) {
      dialog.classList.add('cf-private-success-fallback');
      dialog.setAttribute('open', '');
    }
    dialog.querySelector('[data-close-private-success]')?.focus({ preventScroll: true });
  }
  async requestPrivateEvent(form) {
    if(form.dataset.submitted==='true')return;
    const status = this.q('#cf-private-event-status');
    const manual = this.q('#cf-private-event-manual');
    status.hidden = true; manual.hidden = true;
    if (!form.reportValidity()) return;
    const value = field => String(form.elements.namedItem(field)?.value || '').trim();
    const name = value('customer_name');
    const phone = normalizeBRWhatsApp(value('customer_whatsapp'));
    const date = value('date');
    const periods = value('period').split(',').filter(Boolean);
    const count = Number(value('people_count'));
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(new Date(`${date}T12:00:00`).getTime()) &&
      new Date(`${date}T12:00:00`).toISOString().slice(0, 10) === date && date >= todayLocal();
    const allowed = ['manha', 'tarde', 'noite'];
    const validPeriods = periods.length > 0 && (this.allowMultiplePeriodsPrivate || periods.length===1) && new Set(periods).size === periods.length &&
      periods.every(id => allowed.includes(id)) && periods.length === this.privateSelectedPeriods.length &&
      periods.every(id => this.privateSelectedPeriods.includes(id));
    if (!name || !phone || !validDate || !validPeriods || !Number.isInteger(count) || count < 1 || count > 100 || date !== this.privateDate) {
      status.textContent = 'Revise o nome, WhatsApp, data futura, turnos e quantidade de participantes.';
      status.hidden = false;
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const result = await this.api('/private-events', { method: 'POST', body: JSON.stringify({
        customer_name:name, customer_whatsapp:phone, date, periods,
        people_count:count, event_type:value('event_type'), notes:value('notes'),
        responsible_adult:form.elements.namedItem('adult_responsible').checked,
        privacy_consent:form.elements.namedItem('contact_consent').checked
      }) });
      // Exibe confirmação em pop-up somente após resposta de sucesso da API.
      // O identificador interno continua sendo gerado no servidor, mas não aparece ao cliente.
      status.textContent = '';
      status.hidden = true;
      submit.textContent = 'Solicitação enviada';
      form.dataset.submitted='true';
      this.showPrivateRequestSuccess();
    } catch(error) {
      status.textContent=error.message;
      status.hidden=false;
    } finally { submit.disabled=form.dataset.submitted==='true'; }
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
  /** Posiciona o início da reserva abaixo do cabeçalho fixo, inclusive no celular. */
  scrollToBookingTop() {
    const intro = this.root.closest('#agendar')?.querySelector('.booking-intro') || this.root;
    const header = document.querySelector('.site-header');
    const headerHeight = header?.getBoundingClientRect().height || 0;
    const pageTop = intro.getBoundingClientRect().top + window.scrollY - headerHeight - 16;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: Math.max(0, pageTop),
      behavior: reducedMotion ? 'auto' : 'smooth'
    });
  }
  renderSelectionSummary() {
    const chosen = this.periods.filter(p => this.selectedPeriods.includes(p.id));
    this.q('#cf-selection-summary').textContent = this.selectedDate && chosen.length
      ? `${formatDate(this.selectedDate)} · ${chosen.map(p => `${p.label} (${p.time})`).join(' + ')}`
      : (this.allowMultiplePeriods?'Escolha uma data e um ou mais turnos':'Escolha uma data e um turno');
  }
  syncClosedPeriods() {
    this.selectedPeriods = this.periods.filter(p => p.status === 'available' && this.selectedPeriods.includes(p.id)).map(p => p.id);
    if(!this.allowMultiplePeriods)this.selectedPeriods=this.selectedPeriods.slice(0,1);
    this.period = this.selectedPeriods[0] || '';
    const chosen = this.periods.filter(p => this.selectedPeriods.includes(p.id));
    this.q('#cf-selected-periods').textContent = chosen.length
      ? `${chosen.length} ${chosen.length === 1 ? 'turno selecionado' : 'turnos selecionados'}: ${chosen.map(p => p.label).join(' + ')}`
      : (this.allowMultiplePeriods ? 'Escolha um ou mais turnos disponíveis.' : 'Escolha apenas um turno disponível.');
    this.renderClosedCombinations();
    this.updateNextDate(); this.renderSelectionSummary();
  }
  renderClosedCombinations() {
    const el=this.q('#cf-period-combinations');
    const combos=[
      {ids:['manha','tarde'], label:'Manhã + Tarde'},
      {ids:['manha','noite'], label:'Manhã + Noite'},
      {ids:['tarde','noite'], label:'Tarde + Noite'},
      {ids:['manha','tarde','noite'], label:'Todos os turnos'}
    ];
    if (!this.allowMultiplePeriods || !this.selectedDate || !this.periods.length) { el.hidden=true; el.innerHTML=''; return; }
    el.hidden=false;
    const free=new Set(this.periods.filter(p=>p.status==='available').map(p=>p.id));
    el.innerHTML=`<strong>Escolha rápida de turnos</strong><div class="cf-private-combination-buttons">${combos.map(c=>{
      const selected=this.selectedPeriods.length===c.ids.length && c.ids.every(id=>this.selectedPeriods.includes(id));
      return `<button type="button" class="cf-private-combination ${selected?'is-active':''}" data-closed-combination="${c.ids.join(',')}" aria-pressed="${selected}" ${c.ids.every(id=>free.has(id))?'':'disabled title="Um ou mais turnos indisponíveis"'}>${selected?'✓ ':''}${c.label}</button>`;
    }).join('')}<button type="button" class="cf-private-combination cf-private-combination-clear" data-closed-combination="" ${this.selectedPeriods.length?'':'disabled'}>Limpar seleção</button></div>`;
  }
  selectClosedCombination(ids) {
    if (!this.allowMultiplePeriods || !this.selectedDate || !Array.isArray(ids)) return;
    const free=new Set(this.periods.filter(p=>p.status==='available').map(p=>p.id));
    if (new Set(ids).size!==ids.length || ids.some(id=>!free.has(id))) return;
    this.selectedPeriods=[...ids]; this.availableEquipment=null; this.availableAccessories=null; this.accessoriesQty={}; this.equipmentToken++;
    this.selections.fill(''); this.preview=null;
    this.renderPeriods(); this.setError('cf-step1-alert','');
    // Quando o administrador desativa vários turnos, conduz ao próximo botão.
    if (!this.allowMultiplePeriods && this.selectedPeriods.length)
      this.scrollToBookingElement(this.q('#cf-to-equipment'));

  }
  // Impede que o visitante mantenha um turno de um mês após navegar para outro.
  clearSchedule() {
    this.selectedDate = ''; this.period = ''; this.selectedPeriods = []; this.periods = [];
    this.setCalendarCompact('closed', false);
    this.availableEquipment = null; this.availableAccessories = null; this.preview = null;
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
    this.setCalendarCompact('closed', true);
    this.scrollToBookingElement(this.q('#cf-closed .cf-period-panel'));
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
      if (this.selectedPeriods.some(id => !data.some(p => p.id===id && p.status==='available'))) { this.selectedPeriods=[]; this.availableEquipment=null; this.availableAccessories=null; this.accessoriesQty={}; this.selections.fill(''); }
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
    const parent=this.q('#cf-periods');
    if (!this.selectedDate) { parent.innerHTML='<p class="cf-muted">Selecione uma data no calendário para ver os turnos.</p>'; this.syncClosedPeriods(); return; }
    if (!this.periods.length) { parent.innerHTML='<p class="cf-muted">Nenhum turno disponível. Selecione outra data.</p>'; this.syncClosedPeriods(); return; }
    parent.innerHTML=this.periods.map(p=>{
      const available=p.status==='available', isOpen=p.status==='open_event';
      const selected=available && this.selectedPeriods.includes(p.id);
      const status=isOpen?'Lista aberta · ver evento ↗':p.status==='taken'?'Ocupado':'Indisponível';
      return `<button type="button" class="cf-period ${isOpen?'cf-period-open':''} ${selected?'is-selected':''}" ${isOpen?`data-open-event-period="${escape(p.id)}"`:`data-period="${escape(p.id)}"`} ${available||isOpen?'':'disabled'} aria-pressed="${selected}"><span><b>${escape(p.label)}</b><small>${escape(p.time)}</small></span><em>${available?(selected?'✓ Escolhido · remover':'+ Escolher turno'):status}</em></button>`;
    }).join('');
    this.syncClosedPeriods();
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
    if (!this.periods.some(p=>p.id===period && p.status==='available')) return;
    this.selectedPeriods=this.selectedPeriods.includes(period)
      ? this.selectedPeriods.filter(id=>id!==period)
      : (this.allowMultiplePeriods?[...this.selectedPeriods,period]:[period]);
    this.availableEquipment=null; this.availableAccessories=null; this.accessoriesQty={}; this.equipmentToken++;
    this.selections.fill(''); this.preview=null;
    this.renderPeriods(); this.setError('cf-step1-alert','');
    // Quando o administrador desativa vários turnos, conduz ao próximo botão.
    if (!this.allowMultiplePeriods && this.selectedPeriods.length)
      this.scrollToBookingElement(this.q('#cf-to-equipment'));

  }
  updateNextDate() {
    this.q('#cf-to-equipment').disabled=!(
      this.selectedDate && this.selectedPeriods.length &&
      this.days.some(d=>d.date===this.selectedDate && d.status==='available') &&
      this.selectedPeriods.every(id=>this.periods.some(p=>p.id===id && p.status==='available'))
    );
  }
  async loadEquipmentAvailability() {
    const date=this.selectedDate, periods=[...this.selectedPeriods];
    const token=++this.equipmentToken;
    // A mesma locação precisa estar disponível em TODOS os turnos da reserva.
    const [equipmentResults,accessoryResults]=await Promise.all([
      Promise.all(periods.map(id=>this.api(`/equipment/availability?date=${encodeURIComponent(date)}&period=${encodeURIComponent(id)}`))),
      Promise.all(periods.map(id=>this.api(`/accessories/availability?date=${encodeURIComponent(date)}&period=${encodeURIComponent(id)}`)))
    ]);
    if(token!==this.equipmentToken || date!==this.selectedDate || periods.join(',')!==this.selectedPeriods.join(','))return false;
    if(!equipmentResults.length || equipmentResults.some(items=>!Array.isArray(items)) || accessoryResults.some(items=>!Array.isArray(items)))
      throw new Error('Não foi possível consultar o estoque de equipamentos e acessórios.');
    this.availableEquipment=equipmentResults[0].map(item=>({
      ...item,
      units_free:Math.min(...equipmentResults.map(items=>Number(items.find(eq=>eq.id===item.id)?.units_free) || 0))
    }));
    this.availableAccessories=accessoryResults[0].map(item=>({
      ...item,
      units_free:Math.min(...accessoryResults.map(items=>Number(items.find(acc=>acc.id===item.id)?.units_free) || 0))
    }));
    return true;
  }
  async goToEquipment() {
    if (this.isBusy || !this.selectedDate || !this.selectedPeriods.length ||
        !this.days.some(d => d.date === this.selectedDate && d.status === 'available')) return;
    this.setError('cf-step1-alert', ''); this.isBusy = true;
    const btn = this.q('#cf-to-equipment'); btn.disabled = true; btn.textContent = 'Consultando…';
    try {
      if (!this.catalogReady) throw new Error('Catálogo indisponível. O servidor de reservas precisa estar ativo. Atualize a página ou tente novamente.');
      if (!this.selectedPeriods.every(id=>this.periods.some(p=>p.id===id && p.status==='available'))) throw new Error('Um dos turnos não está mais disponível.');
      if (!(await this.loadEquipmentAvailability())) return;
      this.renderPlayers(); this.renderExtras(); this.setStep(2);
      this.scrollToBookingElement(this.q('#cf-step-2'));
    } catch (error) { this.setError('cf-step1-alert', error.message); }
    finally { this.isBusy = false; btn.textContent = 'Continuar: equipamentos ↗'; this.updateNextDate(); }
  }
  changePlayers(delta) {
    this.count = Math.min(10, Math.max(this.minPlayers, this.count + delta));
    while (this.selections.length < this.count) this.selections.push('');
    while (this.playerNames.length < this.count) this.playerNames.push('');
    this.selections = this.selections.slice(0, this.count);
    this.playerNames = this.playerNames.slice(0, this.count);
    // Recalcula as máscaras extras de acordo com o tamanho do grupo.
    // Quantidades já escolhidas não podem superar o novo saldo.
    let adjustedMasks = false;
    for (const item of this.catalog.accessories) {
      if (!isExtraMaskAccessory(item.name)) continue;
      const stock = this.availableAccessories?.find(entry => entry.id === item.id);
      const limit = availableExtraUnits(item, stock, this.count);
      const previous = this.accessoriesQty[item.id] || 0;
      if (previous > limit) { this.accessoriesQty[item.id] = limit; adjustedMasks = true; }
    }
    this.preview = null;
    this.renderPlayers();
    this.renderExtras();
    if (adjustedMasks) this.setError('cf-step2-alert', 'A quantidade de máscaras extras foi ajustada para o estoque disponível após considerar os jogadores.');
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
      return `<div class="cf-equipment-item"><label class="cf-player-name-label"><span>Jogador ${index + 1} — nome opcional</span><input type="text" data-player-name="${index}" minlength="2" maxlength="120" autocomplete="off" placeholder="Pode se cadastrar pelo convite após aprovação" value="${escape(this.playerNames[index] || '')}"/></label><label class="cf-player-equipment-label"><span>Equipamento do jogador ${index + 1}</span><select data-player="${index}" aria-label="Equipamento do jogador ${index + 1}"><option value="">Equipamento próprio / sem aluguel</option>${choices}</select></label></div>`;
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
        const stock=this.availableAccessories?.find(entry=>entry.id===item.id);
        const free=name==='accessories' ? availableExtraUnits(item,stock,this.count) : 100;
        const maxQty=name==='accessories' ? Math.min(100,free) : 10;
        // V12.39: exibir apenas o nome e o preço, sem texto de estoque.
        // Os limites (free/maxQty) continuam sendo aplicados aos botões e validados na API.
        return `<div class="cf-extra-item"><span><strong>${escape(item.name)}</strong><small>${escape(money(item.price))}</small></span><div class="cf-counter cf-counter-small"><button type="button" data-extra="${escape(item.id)}" data-delta="-1" ${qty === 0 ? 'disabled' : ''} aria-label="Diminuir ${escape(item.name)}">−</button><output aria-label="${qty} unidades selecionadas">${qty}</output><button type="button" data-extra="${escape(item.id)}" data-delta="1" ${qty >= maxQty ? 'disabled' : ''} aria-label="Aumentar ${escape(item.name)}" title="Adicionar unidade">+</button></div></div>`;
      }).join('') : '<p class="cf-muted">Nenhum item cadastrado.</p>';
    }
  }
  changeExtra(event, name) {
    const button = event.target.closest('[data-extra]'); if (!button) return;
    const item = this.catalog[name].find(it => it.id === button.dataset.extra);
    if (!item) return;
    const quantities = name === 'accessories' ? this.accessoriesQty : this.ammoQty;
    const stock = name==='accessories' ? this.availableAccessories?.find(acc=>acc.id===item.id) : null;
    if (name==='accessories' && !stock) return; // Sem consulta do servidor, não liberar a locação.
    const free = name==='accessories' ? availableExtraUnits(item,stock,this.count) : 10;
    const maxQty=name==='accessories' ? Math.min(100,free) : 10;
    const next=nonnegativeQty((quantities[item.id] || 0) + Number(button.dataset.delta),maxQty);
    quantities[item.id]=next;
    this.renderExtras();
  }
  currentPayload() {
    const form = this.q('#cf-reservation-form');
    return buildReservationPayload({
      date: this.selectedDate, periods: this.selectedPeriods, count: this.count,
      selections: this.selections, playerNames: this.playerNames, accessories: this.accessoriesQty, ammo: this.ammoQty,
      name: form.elements.customer_name.value.trim(), whatsapp: normalizeBRWhatsApp(form.elements.customer_whatsapp.value) || form.elements.customer_whatsapp.value.trim(),
      notes: form.elements.notes.value.trim()
    });
  }
  async goToReview() {
    if (this.isBusy) return;
    this.setError('cf-step2-alert', '');
    const allNames=this.playerNames.slice(0,this.count).map(n=>n.trim());
    if(allNames.some(n=>n && (n.length<2 || n.length>120))) {
      this.setError('cf-step2-alert','Os nomes preenchidos devem ter de 2 a 120 caracteres. Os jogadores poderão se cadastrar pelo convite após a aprovação.');
      const fields=[...this.q('#cf-player-equipment').querySelectorAll('[data-player-name]')];
      fields.find(input=>input.value.trim() && (input.value.trim().length<2 || input.value.trim().length>120))?.focus();
      return;
    }
    this.isBusy = true;
    const btn = this.q('#cf-to-review'); btn.disabled = true; btn.textContent = 'Calculando…';
    try {
      // Consulta estoque mais uma vez, para evitar seleção com disponibilidade obsoleta.
      if (!(await this.loadEquipmentAvailability())) return;
      const counts = new Map(aggregateEquipment(this.selections).map(s => [s.id, s.qty]));
      for (const [id, qty] of counts) {
        const eq = this.availableEquipment.find(item => item.id === id);
        if (!eq || qty > Number(eq.units_free)) throw new Error('A disponibilidade de equipamentos mudou. Ajuste sua seleção.');
      }
      for(const [id,qty] of Object.entries(this.accessoriesQty)) {
        if(qty<=0)continue;
        const item=this.availableAccessories?.find(a=>a.id===id);
        const catalogItem=this.catalog.accessories.find(a=>a.id===id);
        if(!item || !catalogItem || qty>availableExtraUnits(catalogItem,item,this.count))
          throw new Error('O estoque de acessórios mudou ou não há máscaras extras suficientes para o grupo. Revise as quantidades selecionadas.');
      }
      const preview = await this.api('/reservations/preview', { method: 'POST', body: JSON.stringify(this.currentPayload()) });
      if (!preview || typeof preview.total !== 'number') throw new Error('O resumo de preços retornou incompleto.');
      this.preview = preview;
      this.renderPreview();
      this.setStep(3);
      // Após calcular, mostra novamente o cabeçalho e os passos da reserva.
      // Executa somente em caso de sucesso; erros mantêm o foco no formulário.
      this.scrollToBookingTop();
    } catch (error) { this.setError('cf-step2-alert', error.message); this.renderPlayers(); }
    finally { this.isBusy = false; btn.disabled = false; btn.textContent = 'Ver valores e revisar ↗'; }
  }
  renderPreview() {
    const p = this.preview || {};
    const chosen=this.periods.filter(p=>this.selectedPeriods.includes(p.id));
    const rows = [
      ['Data', formatDate(this.selectedDate)], ['Turnos', chosen.map(p=>`${p.label} · ${p.time}`).join(' + ')],
      ['Jogadores', String(this.count)], ['Entradas', money(p.entry_total)]
    ];
    for (const kind of ['equipment_details', 'accessory_details', 'ammo_details']) {
      for (const line of p[kind] || []) rows.push([`${line.qty}× ${line.name}`, money(line.total)]);
    }
    const lines = rows.map(([label, value]) => `<div><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join('');
    const roster = this.playerNames.slice(0,this.count).map((name,i)=>`<li>${i+1}. ${escape(name || 'Cadastro pelo convite após aprovação')}</li>`).join('');
    this.q('#cf-preview').innerHTML = `${lines}${this.selectedPeriods.length>1?'<p class="cf-multi-pricing-info">Os valores seguem a tabela atual por reserva, sem multiplicação automática pelos turnos. Confirme as condições com a equipe.</p>':''}<div class="cf-player-review"><span>Integrantes da reserva (somente equipe)</span><ol>${roster}</ol></div><div class="cf-total"><span>VALOR TOTAL</span><strong>${escape(money(p.total))}</strong></div><div class="cf-deposit"><span>Para reservar (${escape(p.deposit_percent)}%)</span><strong>${escape(money(p.deposit_amount))}</strong></div><div><span>Restante no dia</span><strong>${escape(money(p.remaining))}</strong></div>`;
  }
  async confirm() {
    if (this.isBusy || this.step !== 3) return;
    const form = this.q('#cf-reservation-form');
    const name = form.elements.customer_name.value.trim();
    const phone = form.elements.customer_whatsapp.value.trim();
    this.setError('cf-step3-alert', '');
    if (!name || !validPhone(phone) || !form.elements.contact_consent.checked || !form.elements.adult_responsible.checked) {
      this.setError('cf-step3-alert', 'Informe nome e WhatsApp com DDD (com ou sem +55) e confirme o consentimento e a responsabilidade.'); return;
    }
    this.isBusy = true;
    const btn = this.q('#cf-confirm'); btn.disabled = true; btn.textContent = 'Enviando solicitação…';
    try {
      // Confirmação e estoque são validados NOVAMENTE pelo backend. Não tratar prévia como reserva.
      this.reservation = await this.api('/reservations', { method: 'POST', body: JSON.stringify({ ...this.currentPayload(), responsible_adult: true, privacy_consent: true }) });
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
    const approvalNotice = `<section class="cf-payment-deadline" aria-labelledby="cf-approval-title"><div class="cf-payment-head"><span class="cf-payment-tag">Próximo passo</span><h5 id="cf-approval-title">Aguardando aprovação do administrador</h5><p>A solicitação já foi enviada ao painel da equipe.</p></div><div class="cf-payment-steps"><ol><li>O administrador verificará a disponibilidade e aprovará ou recusará o pedido.</li><li>Após a aprovação, será gerado um link exclusivo para o seu grupo.</li><li>O responsável poderá compartilhar o link para cada jogador realizar seu cadastro.</li></ol></div><p class="cf-payment-warning">O envio do pedido ainda não confirma a reserva. Aguarde o retorno da equipe pelo WhatsApp e as orientações sobre pagamento.</p></section>`;
    this.q('#cf-confirmation').innerHTML = `<p class="cf-success-greeting">Obrigado, <strong>${escape(r.customer_name || 'visitante')}</strong>! Recebemos o pedido para o seu grupo.</p><div class="cf-summary"><div><span>Protocolo</span><strong>${escape(r.id)}</strong></div><div><span>Data e horário</span><strong>${escape(`${formatDate(r.date)} · ${r.period_label || this.period}`)}</strong></div><div><span>Vagas solicitadas</span><strong>${Number(r.player_count) || this.count}</strong></div><div><span>Total previsto</span><strong>${escape(money(r.total))}</strong></div><div><span>Situação</span><strong>Aguardando aprovação</strong></div></div>${approvalNotice}`;
    this.q('#cf-copy-pix').hidden = true;
    const wa = this.q('#cf-success-whatsapp');
    const paid = this.q('#cf-payment-reported-whatsapp');
    const number = this.settings?.whatsapp_number || this.config.whatsapp;
    const href = whatsAppHref(number, `Olá, equipe do Campo Ferrari! Gostaria de acompanhar minha solicitação de lista fechada. Protocolo: ${r.id}. Data: ${formatDate(r.date)}. Aguardo a aprovação e o link para cadastro dos jogadores.`);
    if (href) { wa.href = href; wa.hidden = false; }
    else { wa.hidden = true; wa.removeAttribute('href'); }
    paid.hidden = true; paid.removeAttribute('href');
  }
  async copyPix() {
    const btn = this.q('#cf-copy-pix');
    try { await navigator.clipboard.writeText(this.settings.pix_key); btn.textContent = 'Chave copiada ✓'; }
    catch { btn.textContent = 'Selecione e copie a chave exibida acima'; }
  }
  resetClosed() {
    this.clearSchedule();
    this.count = this.minPlayers; this.selections = Array(this.count).fill(''); this.playerNames = Array(this.count).fill(''); this.accessoriesQty = {}; this.ammoQty = {};
    this.preview = null; this.reservation = null;
    this.events = []; this.activeEvent = null;
    this.q('#cf-reservation-form').reset(); this.q('#cf-copy-pix').textContent = 'Copiar chave PIX';
    const paid = this.q('#cf-payment-reported-whatsapp');
    paid.hidden = true; paid.removeAttribute('href');
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
        const names = count > 1
          ? `<div class="cf-group-people"><strong>Integrantes do grupo</strong><ol><li>${escape(p.display_name || 'Responsável')} <em>(responsável)</em></li>${Array.from({length:count-1},(_,i)=>`<li>${companions[i] ? escape(companions[i]) : 'Acompanhante (nome privado)'}</li>`).join('')}</ol></div>`
          : '';
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
        !els.contact_consent.checked || !els.adult_responsible.checked) {
      this.setError('cf-open-alert','Confira o nome, WhatsApp com DDD (com ou sem +55), participantes, vagas e autorizações.');return;
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
          event_id:event.id,name,whatsapp:normalizeBRWhatsApp(phone),people_count:count,
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
