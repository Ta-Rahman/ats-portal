<script setup>
// Stellenverwaltung (UC6): alle Stellen mit Status und Bewerbungen je Stufe; anlegen, bearbeiten,
// veröffentlichen, schließen (mit Bestätigungsschritt auf der Seite).
import { computed, nextTick, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError, admin } from '../../api.js';
import { formatDate, jobStatusLabel } from '../../labels.js';
import { employmentTypeLabel, useEmploymentTypes } from '../../employmentTypes.js';

const route = useRoute();
useEmploymentTypes();

const jobs = ref([]);
const stages = ref([]);
const loading = ref(true);
const loadError = ref('');
const statusMessage = ref(
  { angelegt: 'Die Stelle wurde als Entwurf angelegt.', gespeichert: 'Die Änderungen wurden gespeichert.' }[
    route.query.hinweis] ?? '',
);
const errorMessage = ref('');
const busyId = ref(null);
const closingJob = ref(null);

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const body = await admin.listJobs();
    jobs.value = body.jobs;
    stages.value = body.stages;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status !== 401) loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}
load();

// "Eingegangen 2 · Sichtung 1" – nur Stufen mit Bewerbungen, in Pipeline-Reihenfolge.
function stageSummary(job) {
  return stages.value
    .filter((s) => job.stage_counts[s.code])
    .map((s) => `${s.label} ${job.stage_counts[s.code]}`)
    .join(' · ');
}

const hasJobs = computed(() => jobs.value.length > 0);

async function runAction(job, action, successText) {
  busyId.value = job.id;
  statusMessage.value = '';
  errorMessage.value = '';
  try {
    await action(job.id);
    statusMessage.value = successText;
    await load();
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status !== 401) errorMessage.value = e.message;
    await load();
  } finally {
    busyId.value = null;
  }
}

function publish(job) {
  return runAction(job, admin.publishJob, `Die Stelle „${job.title}“ ist jetzt veröffentlicht.`);
}

async function askClose(job) {
  closingJob.value = job;
  await nextTick();
  document.getElementById('schliessen-frage')?.focus();
}

async function cancelClose() {
  const id = closingJob.value?.id;
  closingJob.value = null;
  await nextTick();
  document.getElementById(`schliessen-${id}`)?.focus();
}

async function confirmClose() {
  const job = closingJob.value;
  closingJob.value = null;
  await runAction(job, admin.closeJob, `Die Stelle „${job.title}“ wurde geschlossen.`);
}
</script>

<template>
  <h1>Stellenverwaltung</h1>
  <p>
    <RouterLink class="button" :to="{ name: 'admin-job-new' }">Neue Stelle anlegen</RouterLink>
  </p>

  <p class="form-status" role="status">{{ statusMessage }}</p>
  <p class="form-alert" role="alert">{{ errorMessage }}</p>

  <p v-if="loading">Stellen werden geladen …</p>
  <p v-else-if="loadError" class="message message--error">{{ loadError }}</p>
  <p v-else-if="!hasJobs">Es gibt noch keine Stellen.</p>

  <div v-else class="table-wrapper">
    <table class="data-table">
      <caption class="visually-hidden">Alle Stellen mit Status und Bewerbungen je Stufe</caption>
      <thead>
        <tr>
          <th scope="col">Stelle</th>
          <th scope="col">Status</th>
          <th scope="col">Bewerbungen</th>
          <th scope="col">Aktionen</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="job in jobs" :key="job.id">
          <td>
            <RouterLink :to="{ name: 'admin-kanban', params: { id: job.id } }">{{ job.title }}</RouterLink>
            <span class="cell-meta">{{ job.location }} · {{ employmentTypeLabel(job.employment_type) }}</span>
          </td>
          <td>
            <span class="badge" :class="`badge--${job.status}`">{{ jobStatusLabel(job.status) }}</span>
            <span v-if="job.status === 'published'" class="cell-meta">seit {{ formatDate(job.published_at) }}</span>
            <span v-else-if="job.status === 'closed'" class="cell-meta">am {{ formatDate(job.closed_at) }}</span>
          </td>
          <td>
            <strong>{{ job.application_count }}</strong>
            <span v-if="job.application_count" class="cell-meta">{{ stageSummary(job) }}</span>
          </td>
          <td>
            <div class="actions">
              <RouterLink :to="{ name: 'admin-kanban', params: { id: job.id } }">
                Bewerbungen<span class="visually-hidden"> zu „{{ job.title }}“</span>
              </RouterLink>
              <RouterLink v-if="job.status !== 'closed'" :to="{ name: 'admin-job-edit', params: { id: job.id } }">
                Bearbeiten<span class="visually-hidden"> „{{ job.title }}“</span>
              </RouterLink>
              <button v-if="job.status === 'draft'" type="button" class="button button--small"
                      :disabled="busyId === job.id" @click="publish(job)">
                Veröffentlichen<span class="visually-hidden"> „{{ job.title }}“</span>
              </button>
              <button v-if="job.status === 'published'" :id="`schliessen-${job.id}`" type="button"
                      class="button button--small button--secondary" :disabled="busyId === job.id"
                      @click="askClose(job)">
                Schließen<span class="visually-hidden"> „{{ job.title }}“</span>
              </button>
            </div>
            <div v-if="closingJob?.id === job.id" class="confirm-box confirm-box--inline">
              <p id="schliessen-frage" class="confirm-box__question" tabindex="-1">
                Stelle „{{ job.title }}“ wirklich schließen? Danach sind keine neuen Bewerbungen mehr möglich;
                laufende Bewerbungen bleiben erhalten.
              </p>
              <p class="confirm-box__actions">
                <button type="button" class="button button--danger button--small" @click="confirmClose">
                  Ja, Stelle schließen
                </button>
                <button type="button" class="button button--secondary button--small" @click="cancelClose">
                  Abbrechen
                </button>
              </p>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
