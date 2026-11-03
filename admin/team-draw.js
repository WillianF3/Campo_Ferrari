/** Sorteio local e equilibrado de jogadores, com números estáveis em nomes repetidos. */
const MAX_PLAYERS=100;

export function buildPlayerRoster(reservation){
 const records=Array.isArray(reservation?.players)?reservation.players:[];
 const storedCount=Number(reservation?.player_count);
 const count=Math.min(MAX_PLAYERS,Math.max(
  Number.isInteger(storedCount)&&storedCount>0?storedCount:0,
  records.length
 ));
 // API retorna player_number, organizado; se faltar o número, utiliza a posição.
 const byNumber=new Map();
 for(const [i,record] of records.entries()){
  const rawNumber=Number(record?.number);
  const number=Number.isInteger(rawNumber)&&rawNumber>0&&rawNumber<=count?rawNumber:i+1;
  if(!byNumber.has(number))byNumber.set(number,record);
 }
 return Array.from({length:count},(_,index)=>{
  const number=index+1;
  const record=byNumber.get(number);
  const name=typeof record?.name==='string'?record.name.trim():'';
  const unidentified=!name || /^(nome (não|nao) (informado|registrado)|sem nome|não informado|nao informado)$/i.test(name);
  return {number,name:unidentified?`Jogador ${number}`:name};
 });
}

/** Fisher-Yates com sorteio uniforme (quando Web Crypto estiver disponível). */
function randomBelow(max){
 if(max<=1)return 0;
 if(globalThis.crypto?.getRandomValues){
  const bits=0x100000000;
  const ceiling=Math.floor(bits/max)*max;
  const value=new Uint32Array(1);
  do{globalThis.crypto.getRandomValues(value);}while(value[0]>=ceiling);
  return value[0]%max;
 }
 return Math.floor(Math.random()*max);
}

export function drawBalancedTeams(roster,numberOfTeams){
 const count=Number(numberOfTeams);
 if(!Array.isArray(roster)||roster.length<2)throw Error('Cadastre pelo menos dois jogadores.');
 if(!Number.isInteger(count)||count<2||count>8||count>roster.length)throw Error('Escolha uma quantidade válida de times.');
 const shuffled=roster.slice();
 for(let i=shuffled.length-1;i>0;i--){const j=randomBelow(i+1);[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
 const teams=Array.from({length:count},()=>[]);
 shuffled.forEach((player,i)=>teams[i%count].push(player));
 return teams;
}

export function teamsAsText(teams,details={}){
 const head=['CAMPO FERRARI — SORTEIO DE TIMES'];
 if(details.customer)head.push(`Reserva: ${details.customer}`);
 if(details.date)head.push(`Data: ${details.date}`);
 if(details.period)head.push(`Turno: ${details.period}`);
 return [head.join('\n'),...teams.map((team,index)=>`TIME ${index+1} (${team.length} jogadores)\n${team.map(p=>`${p.number}. ${p.name}`).join('\n')}`)].join('\n\n');
}
