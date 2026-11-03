/** Perguntas frequentes usam <details> nativo para funcionar até sem JavaScript. */
export class FaqController {
  constructor(element) {
    this.element = element;
  }

  init() {
    if (!this.element) return;
    const entries = [...this.element.querySelectorAll('details')];
    entries.forEach(details => {
      // Permite somente uma resposta expandida por vez.
      details.addEventListener('toggle', () => {
        if (details.open) {
          entries.forEach(other => { if (other !== details) other.open = false; });
        }
      });
    });
  }
}
