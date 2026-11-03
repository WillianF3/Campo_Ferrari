/** Apresentacao privada dos equipamentos da Lista Fechada. Nunca usar em paginas publicas. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

/** HTML escapado: nome + equipamento alugado em cada linha. */
export function renderReservationPlayers(players) {
  if (!Array.isArray(players) || players.length === 0)
    return '<small>Reserva antiga: participantes não cadastrados.</small>';

  const rented = players.filter(player => String(player?.equipment_id ?? '').trim() !== '').length;
  const list = players.map((player, index) => {
    const number = Number.isInteger(Number(player?.number)) && Number(player.number) > 0 ? Number(player.number) : index + 1;
    const id = String(player?.equipment_id ?? '').trim();
    const label = id ? (String(player?.equipment_name ?? '').trim() || 'Equipamento alugado (nome indisponível)') : 'Equipamento próprio / sem aluguel';
    const rentalClass = id ? 'is-rental' : 'is-own';
    const confirmed = player?.registered_by_invitation === true ? '<small class="admin-player-origin">Nome confirmado pelo convite</small>' : '';
    return `<li value="${number}"><span class="admin-player-name">${escape(player?.name || 'Nome não informado')}</span>${confirmed}<small class="admin-player-equipment ${rentalClass}">${id ? 'Aluguel: ' : ''}${escape(label)}</small></li>`;
  }).join('');
  return `<small class="admin-rental-summary">${rented} alugado(s) · ${players.length - rented} equipamento(s) próprio(s)</small><ol class="admin-companion-list admin-reservation-players">${list}</ol>`;
}
