<script setup>
// Bewerbungsformular (UC3) mit Bestätigung und einmaliger Anzeige des Status-Links.
// Prüft vorab im Browser (applicationRules.js); maßgeblich sind die Meldungen der API.
// Der Status-Token existiert nur im Speicher dieser Ansicht – nach Neuladen ist er weg.
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { ApiError, fetchConsent, fetchJob, submitApplication } from '../api.js';
import { SITE_NAME } from '../labels.js';
import { FIELD_ORDER, checkApplication } from '../applicationRules.js';

const props = defineProps({ id: { type: String, required: true } });

const FIELD_LABELS = {
  first_name: 'Vorname',
  last_name: 'Nachname',
  email: 'E-Mail-Adresse',
  phone: 'Telefonnummer',
  cover_letter: 'Anschreiben',
  cv: 'Lebenslauf',
  consent: 'Einwilligung',
};

const job = ref(null);
const consent = ref(null);
const loading = ref(true);
const loadError = ref('');
const jobGone = ref(false);

const values = reactive({ first_name: '', last_name: '', email: '', phone: '', cover_letter: '', consent: false });
const file = ref(null);
const errors = ref({});
const generalErrors = ref([]);
const sending = ref(false);
const token = ref('');
const copyMessage = ref('');

const summaryRef = ref(null);
const confirmationHeading = ref(null);

const inputId = (field) => `bewerbung-${field}`;
const errorId = (field) => `fehler-${field}`;
const hintId = (field) => `hinweis-${field}`;

// aria-describedby: Hinweistext (falls vorhanden) und Fehlermeldung (falls vorhanden)
function describedBy(field, hasHint = false) {
  const ids = [];
  if (hasHint) ids.push(hintId(field));
  if (errors.value[field]) ids.push(errorId(field));
  return ids.length ? ids.join(' ') : undefined;
}

const summaryItems = computed(() =>
  FIELD_ORDER.filter((f) => errors.value[f]).map((f) => ({ field: f, label: FIELD_LABELS[f], message: errors.value[f] })),
);
const hasErrors = computed(() => summaryItems.value.length > 0 || generalErrors.value.length > 0);

const statusUrl = computed(() => (token.value ? `${window.location.origin}/status/${token.value}` : ''));

async function load() {
  loading.value = true;
  loadError.value = '';
  jobGone.value = false;
  try {
    const [j, c] = await Promise.all([fetchJob(props.id), fetchConsent()]);
    job.value = j;
    consent.value = c;
    document.title = `Bewerbung: ${j.title} – ${SITE_NAME}`;
  } catch (e) {
    if (e.status === 404 || e.status === 400) jobGone.value = true;
    else loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

watch(() => props.id, load, { immediate: true });

function onFileChange(event) {
  file.value = event.target.files?.[0] ?? null;
}

function focusField(field) {
  document.getElementById(inputId(field))?.focus();
}

async function showErrors() {
  await nextTick();
  summaryRef.value?.focus();
}

// Fehler der API den Feldern zuordnen; was keinem Feld gehört, kommt in die Übersicht.
function applyServerError(e) {
  const fieldErrors = {};
  const general = [];
  for (const d of e.details) {
    const field = d.field === 'consent_version' ? 'consent' : d.field;
    if (FIELD_ORDER.includes(field)) fieldErrors[field] ??= d.message;
    else general.push(d.message);
  }
  if (e.status === 413 && !fieldErrors.cv) fieldErrors.cv = 'Die Datei ist größer als 5 MB.';
  if (e.status === 404) {
    general.push('Diese Stelle ist nicht mehr ausgeschrieben. Eine Bewerbung ist nicht mehr möglich.');
  } else if (Object.keys(fieldErrors).length === 0 && general.length === 0) {
    // 0 = keine Verbindung, 429 = zu viele Bewerbungen (Meldung der API mit Wartezeit)
    general.push([0, 429].includes(e.status) ? e.message
      : 'Beim Senden ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.');
  }
  errors.value = fieldErrors;
  generalErrors.value = general;
}

async function onSubmit() {
  if (sending.value) return;
  sending.value = true;
  generalErrors.value = [];
  try {
    errors.value = await checkApplication(values, file.value);
    if (hasErrors.value) {
      await showErrors();
      return;
    }
    const data = new FormData();
    data.append('first_name', values.first_name);
    data.append('last_name', values.last_name);
    data.append('email', values.email);
    if (values.phone.trim() !== '') data.append('phone', values.phone);
    if (values.cover_letter.trim() !== '') data.append('cover_letter', values.cover_letter);
    data.append('consent', 'true');
    data.append('consent_version', consent.value.version);
    data.append('cv', file.value);
    try {
      token.value = await submitApplication(props.id, data);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      applyServerError(e);
      await showErrors();
      return;
    }
    document.title = `Bewerbung gesendet – ${SITE_NAME}`;
    await nextTick();
    confirmationHeading.value?.focus();
  } finally {
    sending.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(statusUrl.value);
    copyMessage.value = 'Der Link wurde in die Zwischenablage kopiert.';
  } catch {
    copyMessage.value = 'Kopieren war nicht möglich. Bitte markieren und kopieren Sie den Link von Hand.';
  }
}
</script>

<template>
  <template v-if="token">
    <h1 ref="confirmationHeading" tabindex="-1">Vielen Dank für Ihre Bewerbung</h1>
    <p>Ihre Bewerbung auf die Stelle „{{ job.title }}“ ist eingegangen.</p>
    <section class="status-link-box" aria-labelledby="status-link-heading">
      <h2 id="status-link-heading">Ihr persönlicher Status-Link</h2>
      <p class="status-link">
        <RouterLink :to="{ name: 'status', params: { token } }">{{ statusUrl }}</RouterLink>
      </p>
      <p>
        <button type="button" class="button button--secondary" @click="copyLink">Link kopieren</button>
      </p>
      <p class="hint" role="status">{{ copyMessage }}</p>
      <p class="message message--warning">
        Bitte speichern Sie diesen Link jetzt. Er wird nur einmal angezeigt und nicht per E-Mail
        verschickt. Mit dem Link können Sie den Stand Ihrer Bewerbung einsehen und sie zurückziehen.
      </p>
    </section>
    <p><RouterLink to="/stellen">Zurück zu den offenen Stellen</RouterLink></p>
  </template>

  <template v-else>
    <p class="breadcrumb">
      <RouterLink :to="{ name: 'job', params: { id } }">← Zurück zur Stelle</RouterLink>
    </p>

    <h1 v-if="loading">Bewerbung wird vorbereitet …</h1>

    <template v-else-if="jobGone">
      <h1>Stelle nicht gefunden</h1>
      <p>Diese Stelle gibt es nicht oder sie ist nicht mehr ausgeschrieben.</p>
    </template>

    <template v-else-if="loadError">
      <h1>Fehler</h1>
      <p class="message message--error" role="alert">{{ loadError }}</p>
    </template>

    <template v-else>
      <h1>Bewerbung: {{ job.title }}</h1>
      <p>Felder mit <span class="required" aria-hidden="true">*</span> sind Pflichtfelder.</p>

      <div v-if="hasErrors" ref="summaryRef" class="error-summary" tabindex="-1" role="alert"
           aria-labelledby="fehleruebersicht-titel">
        <h2 id="fehleruebersicht-titel">Bitte korrigieren Sie folgende Angaben</h2>
        <ul>
          <li v-for="item in summaryItems" :key="item.field">
            <a :href="`#${inputId(item.field)}`" @click.prevent="focusField(item.field)">
              {{ item.label }}: {{ item.message }}
            </a>
          </li>
          <li v-for="(message, i) in generalErrors" :key="`allg-${i}`">{{ message }}</li>
        </ul>
      </div>

      <form class="application-form" novalidate @submit.prevent="onSubmit">
        <div class="form-field">
          <label :for="inputId('first_name')">Vorname <span class="required" aria-hidden="true">*</span></label>
          <input :id="inputId('first_name')" v-model="values.first_name" type="text" autocomplete="given-name"
                 required :aria-invalid="errors.first_name ? 'true' : undefined"
                 :aria-describedby="describedBy('first_name')" />
          <p v-if="errors.first_name" :id="errorId('first_name')" class="field-error">{{ errors.first_name }}</p>
        </div>

        <div class="form-field">
          <label :for="inputId('last_name')">Nachname <span class="required" aria-hidden="true">*</span></label>
          <input :id="inputId('last_name')" v-model="values.last_name" type="text" autocomplete="family-name"
                 required :aria-invalid="errors.last_name ? 'true' : undefined"
                 :aria-describedby="describedBy('last_name')" />
          <p v-if="errors.last_name" :id="errorId('last_name')" class="field-error">{{ errors.last_name }}</p>
        </div>

        <div class="form-field">
          <label :for="inputId('email')">E-Mail-Adresse <span class="required" aria-hidden="true">*</span></label>
          <input :id="inputId('email')" v-model="values.email" type="email" autocomplete="email"
                 required :aria-invalid="errors.email ? 'true' : undefined"
                 :aria-describedby="describedBy('email')" />
          <p v-if="errors.email" :id="errorId('email')" class="field-error">{{ errors.email }}</p>
        </div>

        <div class="form-field">
          <label :for="inputId('phone')">Telefonnummer (optional)</label>
          <input :id="inputId('phone')" v-model="values.phone" type="tel" autocomplete="tel"
                 :aria-invalid="errors.phone ? 'true' : undefined"
                 :aria-describedby="describedBy('phone')" />
          <p v-if="errors.phone" :id="errorId('phone')" class="field-error">{{ errors.phone }}</p>
        </div>

        <div class="form-field">
          <label :for="inputId('cover_letter')">Anschreiben (optional)</label>
          <p :id="hintId('cover_letter')" class="hint">Höchstens 10 000 Zeichen.</p>
          <textarea :id="inputId('cover_letter')" v-model="values.cover_letter" rows="8"
                    :aria-invalid="errors.cover_letter ? 'true' : undefined"
                    :aria-describedby="describedBy('cover_letter', true)"></textarea>
          <p v-if="errors.cover_letter" :id="errorId('cover_letter')" class="field-error">{{ errors.cover_letter }}</p>
        </div>

        <div class="form-field">
          <label :for="inputId('cv')">Lebenslauf <span class="required" aria-hidden="true">*</span></label>
          <p :id="hintId('cv')" class="hint">Eine PDF-Datei, höchstens 5 MB.</p>
          <input :id="inputId('cv')" type="file" accept=".pdf,application/pdf" required
                 :aria-invalid="errors.cv ? 'true' : undefined"
                 :aria-describedby="describedBy('cv', true)" @change="onFileChange" />
          <p v-if="errors.cv" :id="errorId('cv')" class="field-error">{{ errors.cv }}</p>
        </div>

        <section class="privacy-note" aria-labelledby="datenschutz-titel">
          <h2 id="datenschutz-titel">Hinweis zum Datenschutz</h2>
          <p>{{ consent.privacy_note }}</p>
        </section>

        <div class="form-field form-field--checkbox">
          <input :id="inputId('consent')" v-model="values.consent" type="checkbox" required
                 :aria-invalid="errors.consent ? 'true' : undefined"
                 :aria-describedby="describedBy('consent')" />
          <label :for="inputId('consent')">
            {{ consent.text }} <span class="required" aria-hidden="true">*</span>
          </label>
          <p v-if="errors.consent" :id="errorId('consent')" class="field-error">{{ errors.consent }}</p>
        </div>

        <p>
          <button type="submit" class="button" :disabled="sending">
            {{ sending ? 'Wird gesendet …' : 'Bewerbung absenden' }}
          </button>
        </p>
      </form>
    </template>
  </template>
</template>
