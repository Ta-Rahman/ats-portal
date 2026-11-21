<script setup>
// Karrierestartseite: kurze Einleitung und die neuesten offenen Stellen (Teaser).
import { onMounted, ref } from 'vue';
import { fetchJobs } from '../api.js';
import { SITE_NAME } from '../labels.js';
import JobSummary from '../components/JobSummary.vue';

const TEASER_COUNT = 3;
const jobs = ref([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    // Die API liefert bereits neueste zuerst.
    jobs.value = (await fetchJobs()).slice(0, TEASER_COUNT);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <h1>Karriere bei der {{ SITE_NAME }}</h1>
  <p class="lead">
    Wir sind ein kleines IT-Dienstleistungsunternehmen mit rund 40 Mitarbeitenden. Hier finden Sie
    unsere offenen Stellen – eine Bewerbung ist ohne Benutzerkonto möglich.
  </p>

  <section aria-labelledby="teaser-heading">
    <h2 id="teaser-heading">Neueste offene Stellen</h2>
    <p v-if="loading" role="status">Stellen werden geladen …</p>
    <p v-else-if="error" class="message message--error" role="alert">{{ error }}</p>
    <p v-else-if="jobs.length === 0">Zurzeit sind keine Stellen ausgeschrieben.</p>
    <ul v-else class="job-list">
      <li v-for="job in jobs" :key="job.id">
        <JobSummary :job="job" :heading-level="3" />
      </li>
    </ul>
    <p>
      <RouterLink class="button button--secondary" to="/stellen">Alle offenen Stellen ansehen</RouterLink>
    </p>
  </section>
</template>
