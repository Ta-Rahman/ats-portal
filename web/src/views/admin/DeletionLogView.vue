<script setup>
// Löschprotokoll (UC13, nur Admin): ein Eintrag je automatisch gelöschter Bewerbung – nur Stelle,
// Stufe, Zeitpunkte und Anzahl der Dateien, keine personenbezogenen Daten. Filter nach Löschdatum.
import { computed, nextTick, reactive, ref } from 'vue';
import { ApiError, admin } from '../../api.js';
import { formatDate, formatDateTime } from '../../labels.js';
import ErrorSummary from '../../components/ErrorSummary.vue';

const FIELDS = { from: 'Gelöscht von', to: 'Gelöscht bis' };
const filter = reactive({ from: '', to: '' });
const entries = ref([]);
const loading = ref(true);
const errors = ref({});
const general = ref([]);
const summary = ref(null);
const inputId = (field) => `protokoll-${field}`;
const errorId = (field) => `fehler-protokoll-${field}`;

const summaryItems = computed(() => [
  ...Object.keys(FIELDS).filter((f) => errors.value[f])
    .map((f) => ({ target: inputId(f), label: FIELDS[f], message: errors.value[f] })),
  ...general.value.map((message) => ({ message })),
]);

async function load() {
  loading.value = true;
  errors.value = {};
  general.value = [];
  try {
    entries.value = await admin.deletionLog({ from: filter.from, to: filter.to });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 401) return;
    const fieldErrors = {};
    for (const d of e.details) if (FIELDS[d.field]) fieldErrors[d.field] ??= d.message;
    errors.value = fieldErrors;
    if (!Object.keys(fieldErrors).length) general.value = [e.message];
    entries.value = [];
    await nextTick();
    summary.value?.focus();
  } finally {
    loading.value = false;
  }
}
load();

function reset() {
  filter.from = '';
  filter.to = '';
  load();
}

const fileCount = (n) => `${n} ${n === 1 ? 'Datei' : 'Dateien'}`;
</script>

<template>
  <h1>Löschprotokoll</h1>
  <p class="hint">
    Abgeschlossene Bewerbungen werden 6 Monate nach Abschluss automatisch gelöscht – samt Lebenslauf,
    Notizen und Verlauf. Das Protokoll hält nur fest, dass gelöscht wurde: Stelle, Stufe, Zeitpunkte und
    Anzahl der Dateien, keine personenbezogenen Daten.
  </p>

  <ErrorSummary ref="summary" :items="summaryItems" />
  <form class="filters" role="search" aria-label="Löschprotokoll filtern" novalidate @submit.prevent="load">
    <div class="form-field">
      <label :for="inputId('from')">Gelöscht von</label>
      <input :id="inputId('from')" v-model="filter.from" type="date"
             :aria-invalid="errors.from ? 'true' : undefined"
             :aria-describedby="errors.from ? errorId('from') : undefined" />
      <p v-if="errors.from" :id="errorId('from')" class="field-error">{{ errors.from }}</p>
    </div>
    <div class="form-field">
      <label :for="inputId('to')">Gelöscht bis</label>
      <input :id="inputId('to')" v-model="filter.to" type="date"
             :aria-invalid="errors.to ? 'true' : undefined"
             :aria-describedby="errors.to ? errorId('to') : undefined" />
      <p v-if="errors.to" :id="errorId('to')" class="field-error">{{ errors.to }}</p>
    </div>
    <p class="filters__actions">
      <button type="submit" class="button button--small">Filtern</button>
      <button type="button" class="button button--small button--secondary" @click="reset">Zurücksetzen</button>
    </p>
  </form>

  <p v-if="loading">Protokoll wird geladen …</p>
  <p v-else-if="!entries.length && !summaryItems.length" role="status">Keine Löschungen im gewählten Zeitraum.</p>
  <div v-else-if="entries.length" class="table-wrapper">
    <table class="data-table">
      <caption>{{ entries.length }} {{ entries.length === 1 ? 'Löschung' : 'Löschungen' }}</caption>
      <thead>
        <tr>
          <th scope="col">Gelöscht am</th>
          <th scope="col">Stelle</th>
          <th scope="col">Stufe bei Abschluss</th>
          <th scope="col">Abgeschlossen am</th>
          <th scope="col">Lebenslauf-Dateien</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in entries" :key="entry.id">
          <td>{{ formatDateTime(entry.deleted_at) }}</td>
          <td>
            {{ entry.job_title ?? 'Stelle nicht mehr vorhanden' }}
            <span class="cell-meta">Stellen-Nr. {{ entry.job_id }}</span>
          </td>
          <td>{{ entry.stage_label ?? entry.stage_at_deletion }}</td>
          <td>{{ formatDate(entry.closed_at) }}</td>
          <td>{{ fileCount(entry.attachments_removed) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
