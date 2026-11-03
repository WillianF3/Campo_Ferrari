/** Isola a integração externa. Criar o link não envia mensagens. */
import { whatsAppHref, normalizeBRWhatsApp } from './WhatsAppBooking.js?v=20261026-whatsapp-55-v10-5';
export class ContactService {
  constructor(phone) { this.phone = phone; }
  isConfigured() { return normalizeBRWhatsApp(this.phone) !== null; }
  createLink(message) { return whatsAppHref(this.phone, message); }
}
