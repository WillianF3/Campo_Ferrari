import { siteConfig } from './config/site.js?v=20261023-mapa-1';
import { FaqController } from './controllers/FaqController.js?v=20261023-deps-2';
import { SiteController } from './controllers/SiteController.js?v=20261023-mapa-1';
import { BookingWizard } from './controllers/BookingWizard.js?v=20261023-grupos-1';
import { AnimationController } from './controllers/AnimationController.js?v=20261023-deps-2';
import { NavigationController } from './controllers/NavigationController.js?v=20261023-deps-2';

// O front-end JavaScript consome a API PHP/MySQL no mesmo domínio, sem iframe.
const wizard = new BookingWizard(siteConfig);
wizard.init();
new FaqController(document.querySelector('#duvidas .faq')).init();
new NavigationController().init();
new SiteController(siteConfig, wizard).init();
new AnimationController().init();
