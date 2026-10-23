// Edite os dados comerciais aqui. Não coloque segredos neste arquivo público.
export const siteConfig = {
  name: 'Campo Ferrari',
  // Exemplo de formato: código do país + DDD + número, somente dígitos.
  whatsapp: '5549991032914',
  apiBaseUrl: new URL('../../../', import.meta.url).pathname.replace(/\/$/, ''), // Funciona também em localhost/campo-ferrari/.
  instagram: 'https://www.instagram.com/campo_ferrari/',
  // Link do mesmo local exibido no mapa incorporado, sem depender do endereço textual.
  mapsUrl: 'https://www.google.com/maps?cid=18347507420627434884',
  address: 'Linha Ferrari, Iomerê - SC, 89558-000, Brasil',
  packages: [
    { id: 'iniciante', name: 'Primeira missão', label: 'PARA COMEÇAR', symbol: '◎', price: null, description: 'Nunca jogou airsoft? Fique tranquilo! Oferecemos instrução para iniciantes e equipamentos de locação com EPIs inclusos. Aprenda, divirta-se e jogue com honra!', features: ['Equipamento sob consulta', 'Introdução às regras', 'Experiência em equipe'], featured: false },
    { id: 'operador', name: 'Pronto para o jogo', label: 'PARA QUEM JÁ JOGA', symbol: '⌖', price: null, description: 'Já tem seu equipamento? Pague a entrada, siga as regras do campo e do airsoft e venha jogar. Respeite os adversários, reconheça os disparos e mantenha sempre a honra!', features: ['Entrada consultada no sistema de reservas', 'Equipamento próprio', 'Participação em partidas'], featured: true },
    { id: 'equipe', name: 'Missão em equipe', label: 'PARA REUNIR A GALERA', symbol: '↗', price: null, description: 'Reúna os amigos e monte sua equipe! Ideal para grupos de jogadores experientes, iniciantes ou mistos. Trabalhe em equipe, respeite as regras e mantenha a honra em cada missão!', features: ['Indicado para grupos de 6 a 10 pessoas', 'Solicitação para grupos', 'Valores e disponibilidade no sistema'], minPlayers: 6, featured: false }
  ]
};
