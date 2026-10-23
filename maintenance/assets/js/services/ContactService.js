/** Isola a integração externa. Criar o link não envia mensagens. */
export class ContactService {
  constructor(phone) { this.phone = phone; }
  isConfigured() { return /^\d{10,15}$/.test(this.phone); }
  createLink(message) {
    return this.isConfigured() ? `https://wa.me/${this.phone}?text=${encodeURIComponent(message)}` : null;
  }
}
