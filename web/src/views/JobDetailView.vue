<script setup>
// Stellendetail (UC2) mit Button "Bewerben" (führt zum Bewerbungsformular, UC3).
import { ref, watch } from 'vue';
import { fetchJob } from '../api.js';
import { SITE_NAME, formatDate } from '../labels.js';
import { employmentTypeLabel, useEmploymentTypes } from '../employmentTypes.js';

const props = defineProps({ id: { type: String, required: true } });
useEmploymentTypes();

const job = ref(null);
const loading = ref(true);
const notFound = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  notFound.value = false;
  error.value = '';
  job.value = null;
  try {
    job.value = await fetchJob(props.id);
    document.title = `${job.value.title} – ${SITE_NAME}`;
  } catch (e) {
    // 404 (unbekannt/nicht veröffentlicht) und 400 (ungültige ID) sehen für Besucher gleich aus.
    if (e.status === 404 || e.status === 400) notFound.value = true;
    else error.value = e.message;
  } finally {
    loading.value = false;
  }
}

watch(() => props.id, load, { immediate: true });
</script>

<template>
  <p class="breadcrumb"><RouterLink to="/stellen">← Zurück zur Stellenliste</RouterLink></p>

  <template v-if="loading">
    <h1>Stelle wird geladen …</h1>
  </template>

  <template v-else-if="notFound">
    <h1>Stelle nicht gefunden</h1>
    <p>Diese Stelle gibt es nicht oder sie ist nicht mehr ausgeschrieben.</p>
  </template>

  <template v-else-if="error">
    <h1>Fehler</h1>
    <p class="message message--error" role="alert">{{ error }}</p>
  </template>

  <article v-else-if="job" class="job-detail">
    <h1>{{ job.title }}</h1>
    <dl class="facts">
      <div>
        <dt>Ort</dt>
        <dd>{{ job.location }}</dd>
      </div>
      <div>
        <dt>Beschäftigungsart</dt>
        <dd>{{ employmentTypeLabel(job.employment_type) }}</dd>
      </div>
      <div>
        <dt>Veröffentlicht am</dt>
        <dd><time :datetime="job.published_at">{{ formatDate(job.published_at) }}</time></dd>
      </div>
    </dl>

    <h2>Beschreibung</h2>
    <p class="description">{{ job.description }}</p>

    <p>
      <RouterLink class="button" :to="{ name: 'apply', params: { id: job.id } }">Bewerben</RouterLink>
    </p>
  </article>
</template>
