<script setup>
// Stellenliste mit Filtern nach Ort und Beschäftigungsart (UC1).
// Die Filter stehen in der URL (?ort=…&art=…), damit gefilterte Listen verlinkbar sind.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { fetchJobs } from '../api.js';
import { useEmploymentTypes } from '../employmentTypes.js';
import JobSummary from '../components/JobSummary.vue';

const route = useRoute();
const router = useRouter();
const employmentTypes = useEmploymentTypes(); // Auswahl „Beschäftigungsart“ aus der API

const jobs = ref([]);
const locations = ref([]);
const loading = ref(true);
const error = ref('');

const location = computed(() => (typeof route.query.ort === 'string' ? route.query.ort : ''));
const employmentType = computed(() => (typeof route.query.art === 'string' ? route.query.art : ''));
const hasFilter = computed(() => location.value !== '' || employmentType.value !== '');

const resultText = computed(() => {
  const n = jobs.value.length;
  return n === 1 ? '1 Stelle gefunden' : `${n} Stellen gefunden`;
});

function setFilter(key, value) {
  const query = { ...route.query, [key]: value || undefined };
  router.replace({ query });
}

function resetFilters() {
  router.replace({ query: {} });
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    jobs.value = await fetchJobs({ location: location.value, employmentType: employmentType.value });
  } catch (e) {
    jobs.value = [];
    error.value = e.status === 400 ? 'Ungültiger Filter. Bitte die Auswahl zurücksetzen.' : e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  // Ortsauswahl aus allen veröffentlichten Stellen ableiten (ungefilterte Liste).
  try {
    const all = await fetchJobs();
    locations.value = [...new Set(all.map((j) => j.location))].sort((a, b) => a.localeCompare(b, 'de'));
  } catch {
    locations.value = [];
  }
});

watch(() => [location.value, employmentType.value], load, { immediate: true });
</script>

<template>
  <h1>Offene Stellen</h1>

  <form class="filters" role="search" aria-label="Stellen filtern" @submit.prevent>
    <div class="field">
      <label for="filter-ort">Ort</label>
      <select id="filter-ort" :value="location" @change="setFilter('ort', $event.target.value)">
        <option value="">Alle Orte</option>
        <option v-for="loc in locations" :key="loc" :value="loc">{{ loc }}</option>
      </select>
    </div>
    <div class="field">
      <label for="filter-art">Beschäftigungsart</label>
      <select id="filter-art" :value="employmentType" @change="setFilter('art', $event.target.value)">
        <option value="">Alle Arten</option>
        <option v-for="t in employmentTypes" :key="t.code" :value="t.code">{{ t.label }}</option>
      </select>
    </div>
    <button v-if="hasFilter" type="button" class="button button--secondary" @click="resetFilters">
      Filter zurücksetzen
    </button>
  </form>

  <p class="result-count" aria-live="polite">
    <template v-if="loading">Stellen werden geladen …</template>
    <template v-else-if="!error">{{ resultText }}</template>
  </p>
  <p v-if="error" class="message message--error" role="alert">{{ error }}</p>

  <ul v-if="!loading && jobs.length" class="job-list">
    <li v-for="job in jobs" :key="job.id">
      <JobSummary :job="job" :heading-level="2" />
    </li>
  </ul>
  <p v-else-if="!loading && !error">Für diese Auswahl gibt es zurzeit keine offenen Stellen.</p>
</template>
