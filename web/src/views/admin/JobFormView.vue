<script setup>
// Stelle anlegen (ohne id) oder bearbeiten (mit id) – UC6. Neue Stellen sind immer Entwürfe;
// geschlossene Stellen lassen sich nicht mehr bearbeiten. Maßgeblich sind die Meldungen der API.
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, admin } from '../../api.js';
import { SITE_NAME, jobStatusLabel } from '../../labels.js';
import { useEmploymentTypes } from '../../employmentTypes.js';
import ErrorSummary from '../../components/ErrorSummary.vue';

const props = defineProps({ id: { type: String, default: null } });
const router = useRouter();
const employmentTypes = useEmploymentTypes(); // Auswahl „Beschäftigungsart“ aus der API

const FIELDS = {
  title: 'Titel',
  location: 'Ort',
  employment_type: 'Beschäftigungsart',
  description: 'Beschreibung',
};

const isEdit = computed(() => props.id !== null);
const values = reactive({ title: '', location: '', employment_type: '', description: '' });
const job = ref(null);
const loading = ref(false);
const loadError = ref('');
const errors = ref({});
const general = ref([]);
const sending = ref(false);
const summary = ref(null);

const inputId = (field) => `stelle-${field}`;
const errorId = (field) => `fehler-stelle-${field}`;

const summaryItems = computed(() => [
  ...Object.keys(FIELDS).filter((f) => errors.value[f])
    .map((f) => ({ target: inputId(f), label: FIELDS[f], message: errors.value[f] })),
  ...general.value.map((message) => ({ message })),
]);

async function load() {
  if (!isEdit.value) {
    document.title = `Neue Stelle – ${SITE_NAME}`;
    return;
  }
  loading.value = true;
  loadError.value = '';
  try {
    job.value = await admin.getJob(props.id);
    for (const f of Object.keys(FIELDS)) values[f] = job.value[f];
    document.title = `Stelle bearbeiten: ${job.value.title} – ${SITE_NAME}`;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status !== 401) loadError.value = e.status === 404 || e.status === 400 ? 'Stelle nicht gefunden.' : e.message;
  } finally {
    loading.value = false;
  }
}
watch(() => props.id, load, { immediate: true });

// Vorprüfung im Browser nur auf Pflichtfelder; Längen und Werte prüft die API.
function checkRequired() {
  const missing = {
    title: 'Bitte geben Sie einen Titel an.',
    location: 'Bitte geben Sie einen Ort an.',
    employment_type: 'Bitte wählen Sie eine gültige Beschäftigungsart.',
    description: 'Bitte geben Sie eine Beschreibung an.',
  };
  const found = {};
  for (const f of Object.keys(FIELDS)) if (String(values[f]).trim() === '') found[f] = missing[f];
  return found;
}

async function showErrors() {
  await nextTick();
  summary.value?.focus();
}

async function onSubmit() {
  if (sending.value) return;
  general.value = [];
  errors.value = checkRequired();
  if (summaryItems.value.length) {
    await showErrors();
    return;
  }
  sending.value = true;
  try {
    const data = { ...values };
    if (isEdit.value) {
      await admin.updateJob(props.id, data);
      await router.push({ name: 'admin-jobs', query: { hinweis: 'gespeichert' } });
    } else {
      await admin.createJob(data);
      await router.push({ name: 'admin-jobs', query: { hinweis: 'angelegt' } });
    }
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 401) return;
    const fieldErrors = {};
    const other = [];
    for (const d of e.details) {
      if (FIELDS[d.field]) fieldErrors[d.field] ??= d.message;
      else other.push(d.message);
    }
    if (!Object.keys(fieldErrors).length && !other.length) other.push(e.message);
    errors.value = fieldErrors;
    general.value = other;
    await showErrors();
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <p class="breadcrumb"><RouterLink :to="{ name: 'admin-jobs' }">← Zur Stellenverwaltung</RouterLink></p>
  <h1>{{ isEdit ? 'Stelle bearbeiten' : 'Neue Stelle anlegen' }}</h1>

  <p v-if="loading">Stelle wird geladen …</p>
  <p v-else-if="loadError" class="message message--error">{{ loadError }}</p>
  <p v-else-if="job?.status === 'closed'" class="message message--info">
    Die Stelle „{{ job.title }}“ ist geschlossen und kann nicht mehr bearbeitet werden.
  </p>

  <template v-else>
    <p v-if="isEdit && job">Status: {{ jobStatusLabel(job.status) }}</p>
    <p v-else class="hint">Neue Stellen werden als Entwurf angelegt und erst mit „Veröffentlichen“ öffentlich.</p>

    <ErrorSummary ref="summary" :items="summaryItems" />

    <form class="application-form" novalidate @submit.prevent="onSubmit">
      <div class="form-field">
        <label :for="inputId('title')">Titel</label>
        <input :id="inputId('title')" v-model="values.title" type="text" required maxlength="200"
               :aria-invalid="errors.title ? 'true' : undefined"
               :aria-describedby="errors.title ? errorId('title') : undefined" />
        <p v-if="errors.title" :id="errorId('title')" class="field-error">{{ errors.title }}</p>
      </div>
      <div class="form-field">
        <label :for="inputId('location')">Ort</label>
        <input :id="inputId('location')" v-model="values.location" type="text" required maxlength="100"
               :aria-invalid="errors.location ? 'true' : undefined"
               :aria-describedby="errors.location ? errorId('location') : undefined" />
        <p v-if="errors.location" :id="errorId('location')" class="field-error">{{ errors.location }}</p>
      </div>
      <div class="form-field">
        <label :for="inputId('employment_type')">Beschäftigungsart</label>
        <select :id="inputId('employment_type')" v-model="values.employment_type" required
                :aria-invalid="errors.employment_type ? 'true' : undefined"
                :aria-describedby="errors.employment_type ? errorId('employment_type') : undefined">
          <option value="" disabled>Bitte wählen</option>
          <option v-for="t in employmentTypes" :key="t.code" :value="t.code">{{ t.label }}</option>
        </select>
        <p v-if="errors.employment_type" :id="errorId('employment_type')" class="field-error">
          {{ errors.employment_type }}
        </p>
      </div>
      <div class="form-field">
        <label :for="inputId('description')">Beschreibung</label>
        <p id="hinweis-stelle-description" class="hint">Absätze mit Leerzeilen trennen; höchstens 20 000 Zeichen.</p>
        <textarea :id="inputId('description')" v-model="values.description" rows="12" required
                  :aria-invalid="errors.description ? 'true' : undefined"
                  :aria-describedby="['hinweis-stelle-description', errors.description ? errorId('description') : '']
                    .filter(Boolean).join(' ')"></textarea>
        <p v-if="errors.description" :id="errorId('description')" class="field-error">{{ errors.description }}</p>
      </div>
      <p>
        <button type="submit" class="button" :disabled="sending">
          {{ sending ? 'Wird gespeichert …' : (isEdit ? 'Änderungen speichern' : 'Als Entwurf anlegen') }}
        </button>
      </p>
    </form>
  </template>
</template>
