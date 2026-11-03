/** Mensagens e links de WhatsApp do Campo Ferrari.
 * Versão 10.3: textos individuais sem emojis e sem marcações Markdown, para evitar
 * símbolos de substituição (�) e negritos quebrados no WhatsApp.
 * Links apenas preenchem mensagens, nunca realizam envio automático.
 */
function cleanWhatsAppText(value, fallback = '') {
  // Limita conteúdos oriundos de formulários a uma linha de texto simples.
  const text = String(value ?? '').normalize('NFC')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200D\uFE0F]/gu, '')
    .replace(/[\u0000-\u001f\u007f\ufffd*_~`]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text || fallback;
}
const firstName = fullName => {
  const name = cleanWhatsAppText(fullName).split(/\s+/)[0] || 'pessoal';
  return name.charAt(0).toLocaleUpperCase('pt-BR') + name.slice(1).toLocaleLowerCase('pt-BR');
};
const formatDate = date => /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))
  ? `${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(0,4)}` : cleanWhatsAppText(date, 'a confirmar');
const currency = value => new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'}).format(Number(value) || 0);

/**
 * Normaliza WhatsApp brasileiro para 55 + DDD + número, só com dígitos.
 * Aceita contatos colados/autopreenchidos com +55, 55 ou apenas DDD.
 * Exemplos: (49) 99999-9999, 5549999999999 e +55 (49) 99999-9999.
 */
export function normalizeBRWhatsApp(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const national = digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2) : digits;
  // Exige DDD de 2 dígitos e número de 8 ou 9 dígitos.
  if (!/^[1-9][1-9]\d{8,9}$/.test(national)) return null;
  return `55${national}`;
}

export function whatsAppHref(number, message) {
  const normalized = normalizeBRWhatsApp(number);
  return normalized ? `https://wa.me/${normalized}?text=${encodeURIComponent(message)}` : null;
}

/** O ISO gerado pela API possui fuso horário explícito (-03:00). */
export function formatPaymentDeadline(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

/** Mensagem que o cliente pode enviar à organização após registrar uma reserva. */
export function buildCustomerReservationMessage(r) {
  const name = cleanWhatsAppText(r.customer_name, 'Cliente');
  const period = cleanWhatsAppText(r.period_label || r.period, 'a confirmar');
  const deadline = formatPaymentDeadline(r.payment_deadline_at);
  return [
    'Olá, equipe do Campo Ferrari!',
    '',
    `Meu nome é ${name} e registrei uma solicitação de reserva para nosso grupo.`,
    '',
    `Data: ${formatDate(r.date)}`,
    `Turno: ${period}`,
    `Jogadores: ${Number(r.player_count) || 0}`,
    `Valor total: ${currency(r.total)}`,
    `Valor para reservar: ${currency(r.deposit_amount)}`,
    deadline ? `Prazo para pagamento da reserva: ${deadline} (12 horas após o cadastro)` : 'Prazo para pagamento da reserva: 12 horas após o cadastro',
    '',
    'Gostaria de confirmar a disponibilidade do campo para nosso grupo.'
  ].join('\n');
}

/** Texto enviado pelo cliente quando informa que realizou o pagamento da reserva.
 * O link do WhatsApp apenas prepara o contato. A equipe precisa confirmar o recebimento.
 */
export function buildPaymentReportedMessage(r) {
  const name = cleanWhatsAppText(r.customer_name, 'Cliente');
  const period = cleanWhatsAppText(r.period_label || r.period, 'a confirmar');
  return [
    'Olá, equipe do Campo Ferrari!',
    '',
    `Meu nome é ${name} e informo que já realizei o pagamento da reserva para nosso grupo.`,
    '',
    `Data do jogo: ${formatDate(r.date)}`,
    `Turno(s): ${period}`,
    `Jogadores: ${Number(r.player_count) || 0}`,
    `Valor da reserva: ${currency(r.deposit_amount)}`,
    '',
    'Podem verificar o recebimento e confirmar a situação da reserva?',
    'Caso necessário, posso encaminhar o comprovante por aqui.'
  ].join('\n');
}

/** Primeiro contato feito pelo administrador com um inscrito da lista aberta. */
export function buildOpenListContactMessage(person) {
  const name = firstName(person.name);
  const period = cleanWhatsAppText(person.event_period || person.preferred_period);
  const periodLabel = ({manha:'Manhã',tarde:'Tarde',noite:'Noite'})[period] || 'a confirmar';
  return [
    `Olá, ${name}! Tudo bem?`,
    '',
    'Aqui é a equipe do Campo Ferrari Airsoft.',
    '',
    `Recebemos sua inscrição para o evento "${cleanWhatsAppText(person.event_title, 'Jogo de Lista Aberta')}".`,
    '',
    `Data: ${formatDate(person.event_date || person.preferred_date)}`,
    `Turno: ${periodLabel}`,
    `Participantes do grupo: ${Number(person.people_count) || 1}`,
    '',
    'Estou entrando em contato para confirmar os detalhes da participação e passar as orientações do evento. Podemos conversar por aqui?'
  ].join('\n');
}

/** Contato da organização com o responsável por reserva fechada. */
export function buildClosedListContactMessage(reservation) {
  const period = cleanWhatsAppText(reservation.period_label || (Array.isArray(reservation.periods) ? reservation.periods.map(id => ({manha:'Manhã',tarde:'Tarde',noite:'Noite'})[id] || id).join(' + ') : reservation.period), 'a confirmar');
  return [
    `Olá, ${firstName(reservation.customer_name)}! Tudo bem?`,
    '',
    'Aqui é a equipe do Campo Ferrari Airsoft.',
    '',
    'Recebemos sua solicitação de reserva. Seguem os dados cadastrados:',
    '',
    `Data: ${formatDate(reservation.date)}`,
    `Turnos: ${period}`,
    `Jogadores: ${Number(reservation.player_count) || 0}`,
    `Valor para reservar: ${currency(reservation.deposit_amount)}`,
    '',
    'O prazo informado para o pagamento da reserva é de 12 horas após o cadastro, seguindo as orientações da organização.',
    'Estamos entrando em contato para confirmar a disponibilidade e orientar os próximos passos. Podemos conversar por aqui?'
  ].join('\n');
}

/** Resposta inicial ao autor de sugestão/avaliação. */
export function buildSuggestionContactMessage(person) {
  return [
    `Olá, ${firstName(person.name)}! Tudo bem?`,
    '',
    'Aqui é a equipe do Campo Ferrari Airsoft.',
    '',
    'Recebemos sua mensagem pelo nosso site e agradecemos por compartilhar sua opinião.',
    'Gostaríamos de conversar sobre seu comentário. Podemos falar por aqui?'
  ].join('\n');
}
