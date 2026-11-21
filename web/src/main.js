// Einstieg der SPA.
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { onUnauthorized } from './api.js';
import { clearSession } from './auth.js';
import './style.css';

// Antwortet der interne Bereich mit 401 (Sitzung abgelaufen oder beendet), zur Anmeldung wechseln
// und danach zur aktuellen Seite zurückkehren.
onUnauthorized(() => {
  clearSession();
  const current = router.currentRoute.value;
  if (current.name !== 'login') {
    router.push({ name: 'login', query: { weiter: current.fullPath, abgelaufen: '1' } });
  }
});

createApp(App).use(router).mount('#app');
