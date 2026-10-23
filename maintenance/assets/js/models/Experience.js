/** Entidade responsável pelas regras de preço de uma experiência. */
export class Experience {
  constructor({id, name, label, symbol, price, description, features, minPlayers = 1, featured = false}) {
    if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error('Preço inválido.');
    Object.assign(this, {id, name, label, symbol, price, description, features, minPlayers, featured});
  }
  validatePlayers(players) {
    if (!Number.isInteger(players) || players < this.minPlayers || players > 10) {
      throw new Error(`Escolha entre ${this.minPlayers} e 10 jogadores para esta experiência.`);
    }
    return players;
  }
}
