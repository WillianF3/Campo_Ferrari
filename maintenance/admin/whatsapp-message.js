/**
 * Mensagem de divulgação da Lista Aberta.
 *
 * Os dados vêm de respostas autenticadas do painel administrativo; a lista
 * compartilhável usa apenas o nome público abreviado do responsável.
 * Acompanhantes só entram pelo primeiro nome mediante autorização explícita
 * do administrador, nunca com contatos ou nomes completos.
 */
const ACTIVE_STATUSES = new Set(['new', 'contacted', 'resolved']);
const PERIODS = {
  manha: { label: 'Manhã', time: '08:00 às 13:00' },
  tarde: { label: 'Tarde', time: '13:30 às 18:30' },
  noite: { label: 'Noite', time: '19:00 às 23:30' },
};
const LOCATION_URL = 'https://www.google.com/maps?cid=18347507420627434884';
const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function safeLine(value, fallback = '') {
  const cleaned = String(value ?? '').replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/\s+/gu, ' ').trim();
  return cleaned || fallback;
}

function firstName(value) {
  const words = safeLine(value).split(/\s+/u).filter(Boolean);
  const first = words[0] || 'Participante';
  return first[0].toLocaleUpperCase('pt-BR') + first.slice(1).toLocaleLowerCase('pt-BR');
}

function publicName(value) {
  const words = safeLine(value).split(/\s+/u).filter(Boolean);
  if (words.length <= 1) return firstName(value);
  const initial = words[words.length - 1][0].toLocaleUpperCase('pt-BR');
  return `${firstName(value)} ${initial}.`;
}

function displayDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return 'Data a confirmar';
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) return 'Data a confirmar';
  const week = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(day);
  const weekday = week[0].toLocaleUpperCase('pt-BR') + week.slice(1);
  return `${weekday} – ${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * @param {object} event Evento retornado em /api/admin/open-events
 * @param {object[]} registrations Inscrições retornadas em /api/admin/open-list
 * @param {object} settings Configurações retornadas em /api/admin/settings
 * @param {{includeCompanionFirstNames?:boolean}} options
 * @returns {{message:string,occupied:number,remaining:number|null,capacity:number|null,warning:string}}
 */
export function buildOpenListWhatsAppMessage(event, registrations = [], settings = {}, options = {}) {
  if (!event || !event.id) return { message: '', occupied: 0, remaining: null, capacity: null, warning: '' };
  const period = PERIODS[event.period] || {};
  const periodLabel = safeLine(event.period_label, period.label || 'Horário a confirmar');
  const periodTime = safeLine(event.period_time || event.time_info, period.time || 'A confirmar');
  const active = (Array.isArray(registrations) ? registrations : [])
    .filter(reg => String(reg.event_id) === String(event.id) && ACTIVE_STATUSES.has(reg.status));
  const roster = [];
  for (const reg of active) {
    const responsible = publicName(reg.name);
    const count = Math.max(1, Math.min(100, Math.floor(Number(reg.people_count) || 1)));
    roster.push(responsible);
    const companions = Array.isArray(reg.participant_names) ? reg.participant_names : [];
    for (let i = 1; i < count; i++) {
      const companion = options.includeCompanionFirstNames && safeLine(companions[i - 1])
        ? firstName(companions[i - 1])
        : `Acompanhante de ${firstName(reg.name)}`;
      roster.push(companion);
    }
  }
  const numericCapacity = event.max_players === null || event.max_players === undefined || event.max_players === ''
    ? null : Number(event.max_players);
  const capacity = Number.isInteger(numericCapacity) && numericCapacity > 0 ? numericCapacity : null;
  const occupied = roster.length;
  const remaining = capacity === null ? null : Math.max(0, capacity - occupied);
  const warning = (event.has_started ? 'Este evento já começou ou passou. Confira antes de divulgar. ' : '')
    + (capacity === null ? 'Evento sem limite de vagas definido. ' : '')
    + (!safeLine(settings.pix_key) ? 'PIX não configurado no painel. ' : '');
  const title = safeLine(event.title, 'Jogo de Lista Aberta');
  const fieldName = safeLine(settings.field_name, 'Campo Ferrari Airsoft');
  const extraAddress = safeLine(settings.address);
  const fee = settings.entry_fee !== undefined && settings.entry_fee !== null && Number.isFinite(Number(settings.entry_fee))
    ? formatter.format(Number(settings.entry_fee)) : null;
  const lines = [
    '🎯🔥 GAME CAMPO FERRARI AIRSOFT 🔥🎯',
    '',
    `📅 ${displayDate(event.date)}`,
    `⏰ ${periodLabel} – ${periodTime}`,
    '🏁 LISTA ABERTA',
  ];
  if (title.toLocaleLowerCase('pt-BR') !== 'jogo de lista aberta') lines.push(`🎯 ${title}`);
  lines.push('', `📍 ${fieldName}`);
  if (extraAddress) lines.push(`📍 ${extraAddress}`);
  lines.push('', '📌 Localização:', LOCATION_URL, '', '🔫 Temos equipamentos para locação!');
  if (fee !== null) lines.push(`💰 Entrada: ${fee}`);
  if (safeLine(settings.pix_key)) lines.push(`PIX: ${safeLine(settings.pix_key)}`);
  if (safeLine(event.notes)) lines.push('', `📣 Informações do evento: ${safeLine(event.notes)}`);
  lines.push('', capacity === null
    ? `📋 LISTA — ${occupied} participante(s) confirmado(s) no cadastro`
    : `📋 LISTA — ${occupied}/${capacity} inscritos · ${remaining} vaga(s) disponíveis`, '');
  for (let i = 0; i < (capacity === null ? occupied : Math.max(capacity, occupied)); i++) {
    lines.push(`${i + 1}. ${roster[i] ?? '________________'}`);
  }
  lines.push('', '📲 Inscrições e vagas sujeitas à confirmação pela equipe.', '❌❌❌❌❌');
  return { message: lines.join('\n'), occupied, remaining, capacity, warning: warning.trim() };
}
