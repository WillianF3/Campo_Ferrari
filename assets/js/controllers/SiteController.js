import { Experience } from '../models/Experience.js?v=20261023-deps-2';
import { ContactService } from '../services/ContactService.js?v=20261023-deps-2';
import { money } from './BookingWizard.js?v=20261023-deps-2';

/** Site institucional: catálogo editorial, navegação e contatos. Reservas são gerenciadas pelo BookingWizard. */
export class SiteController {
  constructor(config, wizard) {
    this.config = config;
    this.wizard = wizard;
    this.experiences = config.packages.map(item => new Experience(item));
    this.contact = new ContactService(config.whatsapp);
  }
  init() {
    this.renderExperiences();
    // O BookingWizard publica apenas a tarifa de entrada da API, sem dados privados.
    document.addEventListener('cf:pricing-state', event => this.updatePricing(event.detail));
    document.querySelectorAll('[data-contact="whatsapp"]').forEach(link => {
      const text = link.dataset.whatsappMessage || 'Olá! Gostaria de saber mais sobre o Campo Ferrari.';
      link.href = this.contact.createLink(text) || '#contato';
    });
    document.querySelectorAll('[data-contact="instagram"]').forEach(link => link.href = this.config.instagram);
    document.querySelectorAll('[data-contact="maps"]').forEach(link => {
      link.href = this.config.mapsUrl;
    });
    document.querySelector('#year').textContent = new Date().getFullYear();
    document.querySelectorAll('#menu a').forEach(link => link.addEventListener('click', () => {
      const menu = document.querySelector('#menu');
      if (globalThis.bootstrap && menu.classList.contains('show')) bootstrap.Collapse.getOrCreateInstance(menu).hide();
    }));
    document.querySelectorAll('[data-open-list-link]').forEach(link => link.addEventListener('click', () => this.wizard.setMode('open')));
    document.querySelectorAll('[data-booking-link]').forEach(link => link.addEventListener('click', () => this.wizard.setMode('closed')));
  }
  /** Apresenta as experiências; preços completos dependem dos itens escolhidos. */
  renderExperiences() {
    const container = document.querySelector('#experience-list');
    if (!container) return;
    container.replaceChildren(); // Evita cards duplicados em reinicializações.

    this.experiences.forEach(experience => {
      const col = document.createElement('div');
      col.className = 'col-lg-4';
      const card = document.createElement('article');
      card.className = `experience-card${experience.featured ? ' featured' : ''}`;
      card.dataset.experienceId = experience.id;
      const add = (tag, className, text) => {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        card.append(element);
        return element;
      };

      add('div', 'card-kicker', experience.label);
      add('div', 'card-symbol', experience.symbol).setAttribute('aria-hidden', 'true');
      add('h3', '', experience.name);
      add('p', '', experience.description);
      const list = add('ul', '', '');
      experience.features.forEach(feature => {
        const li = document.createElement('li');
        li.textContent = feature;
        list.append(li);
      });

      // A tarifa unitária é exibida quando /api/settings/public responder.
      // Nunca inventamos preço de pacote: acessórios e locação variam.
      const price = add('div', 'price price-live', '');
      price.dataset.priceFor = experience.id;
      const value = document.createElement('strong');
      value.className = 'price-live-value';
      value.textContent = 'Consultando entrada…';
      const disclaimer = document.createElement('small');
      disclaimer.className = 'price-live-detail';
      disclaimer.textContent = 'Valores completos dependem das opções escolhidas.';
      price.append(value, disclaimer);

      const button = add('a', `btn ${experience.featured ? 'btn-accent' : 'btn-outline-light'}`, 'Escolher experiência ↗');
      button.href = '#agendar';
      button.dataset.selectExperience = experience.id;
      button.setAttribute('aria-label', `Escolher ${experience.name} e ir à seção de agendamento`);
      button.addEventListener('click', () => {
        // Mantém o fluxo existente de reserva sob controle do responsável.
        this.wizard.selectExperience(experience.id);
        container.querySelectorAll('.experience-card').forEach(item => {
          item.classList.toggle('is-selected', item.dataset.experienceId === experience.id);
        });
        const note = document.querySelector('#experience-choice-status');
        if (note) note.textContent = `${experience.name} selecionada. Confira as informações na seção de agendamento.`;
        // Depois da navegação pela âncora, o título pode receber foco do teclado.
        const heading = document.querySelector('#booking-title');
        if (heading) {
          heading.tabIndex = -1;
          requestAnimationFrame(() => heading.focus({ preventScroll: true }));
        }
      });
      col.append(card);
      container.append(col);
    });
  }

  /** Tarifa de entrada informada pelo servidor; falhas não viram preços fictícios. */
  updatePricing({ connected, entryFee } = {}) {
    const amount = entryFee === null || entryFee === undefined || entryFee === '' ? NaN : Number(entryFee);
    const valid = connected === true && Number.isFinite(amount) && amount >= 0;
    document.querySelectorAll('[data-price-for]').forEach(price => {
      const value = price.querySelector('.price-live-value');
      const detail = price.querySelector('.price-live-detail');
      if (valid) {
        value.textContent = `Entrada: ${money(amount)} / pessoa`;
        detail.textContent = 'Locação e outros itens não estão incluídos nesta tarifa.';
      } else {
        value.textContent = 'Valores sob consulta';
        detail.textContent = 'Não foi possível carregar a tarifa. Confirme com a administração.';
      }
      price.classList.toggle('price-unavailable', !valid);
    });
    const status = document.querySelector('#experience-pricing-status');
    if (status) {
      status.textContent = valid
        ? 'Valor da entrada obtido do sistema. O total pode variar conforme as escolhas e será calculado separadamente.'
        : 'Preços online indisponíveis no momento. Verifique a conexão da API e do banco de dados ou consulte a administração.';
      status.classList.toggle('is-warning', !valid);
    }
  }
  // Painel HTML/JS integrado ao backend PHP/MySQL local.

}
