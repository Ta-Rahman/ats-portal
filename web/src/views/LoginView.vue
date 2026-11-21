<script setup>
// Anmeldung für Recruiter und Admin. Bei Fehlern: Übersicht oben mit Fokus (wie im
// Bewerbungsformular); die API meldet unbekannte E-Mail, falsches Passwort und deaktivierte
// Konten mit derselben Meldung. Nach der Anmeldung geht es zur ursprünglich angefragten Seite.
import { computed, nextTick, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '../api.js';
import { login, safeReturnPath } from '../auth.js';
import ErrorSummary from '../components/ErrorSummary.vue';

const route = useRoute();
const router = useRouter();

const values = reactive({ email: '', password: '' });
const errors = ref({});
const general = ref([]);
const sending = ref(false);
const summary = ref(null);

const FIELDS = { email: 'E-Mail-Adresse', password: 'Passwort' };
const inputId = (field) => `anmeldung-${field}`;

const notice = computed(() => {
  if (route.query.abgelaufen) return 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.';
  if (route.query.abgemeldet) return 'Sie wurden abgemeldet.';
  if (route.query.weiter) return 'Bitte melden Sie sich an, um diese Seite zu öffnen.';
  return '';
});

const summaryItems = computed(() => [
  ...Object.keys(FIELDS).filter((f) => errors.value[f])
    .map((f) => ({ target: inputId(f), label: FIELDS[f], message: errors.value[f] })),
  ...general.value.map((message) => ({ message })),
]);

async function showErrors() {
  await nextTick();
  summary.value?.focus();
}

async function onSubmit() {
  if (sending.value) return;
  errors.value = {};
  general.value = [];
  if (values.email.trim() === '') errors.value.email = 'Bitte geben Sie Ihre E-Mail-Adresse an.';
  if (values.password === '') errors.value.password = 'Bitte geben Sie Ihr Passwort an.';
  if (summaryItems.value.length) {
    await showErrors();
    return;
  }
  sending.value = true;
  try {
    await login(values.email.trim(), values.password);
    await router.replace(safeReturnPath(route.query.weiter));
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    values.password = '';
    // 0 = keine Verbindung, 401 = einheitliche Anmeldemeldung, 403 = nur über HTTPS (COOKIE_SECURE),
    // 429 = zu viele Versuche (mit Wartezeit)
    general.value = [[0, 401, 403, 429].includes(e.status) ? e.message : 'Die Anmeldung ist fehlgeschlagen. Bitte versuchen Sie es erneut.'];
    await showErrors();
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <h1>Anmeldung für Mitarbeitende</h1>
  <p v-if="notice" class="message message--info" role="status">{{ notice }}</p>

  <ErrorSummary ref="summary" :items="summaryItems" title="Anmeldung nicht möglich" />

  <form class="application-form login-form" novalidate @submit.prevent="onSubmit">
    <div class="form-field">
      <label :for="inputId('email')">E-Mail-Adresse</label>
      <input :id="inputId('email')" v-model="values.email" type="email" autocomplete="username" required
             :aria-invalid="errors.email ? 'true' : undefined"
             :aria-describedby="errors.email ? 'fehler-anmeldung-email' : undefined" />
      <p v-if="errors.email" id="fehler-anmeldung-email" class="field-error">{{ errors.email }}</p>
    </div>
    <div class="form-field">
      <label :for="inputId('password')">Passwort</label>
      <input :id="inputId('password')" v-model="values.password" type="password" autocomplete="current-password"
             required :aria-invalid="errors.password ? 'true' : undefined"
             :aria-describedby="errors.password ? 'fehler-anmeldung-password' : undefined" />
      <p v-if="errors.password" id="fehler-anmeldung-password" class="field-error">{{ errors.password }}</p>
    </div>
    <p>
      <button type="submit" class="button" :disabled="sending">{{ sending ? 'Anmeldung läuft …' : 'Anmelden' }}</button>
    </p>
  </form>
</template>
