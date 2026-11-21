<script setup>
// Bewerbungen einer Stelle als Kanban (UC7, UC9): Spalten = Pipeline-Stufen, Karten = Bewerbungen.
// Verschieben ohne Drag-and-drop über eine Auswahl je Karte mit den erlaubten Zielstufen (aus der
// API) und den Button „Verschieben“. Ob der Wechsel erlaubt ist, entscheidet der Server.
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { ApiError, admin } from '../../api.js';
import { SITE_NAME, formatDate, jobStatusLabel } from '../../labels.js';

const props = defineProps({ id: { type: String, required: true } });

const board = ref(null);
const loading = ref(true);
const loadError = ref('');
const targets = reactive({}); // gewählte Zielstufe je Bewerbung
const busyId = ref(null);
const statusMessage = ref('');
const errorMessage = ref('');

async function load() {
  loadError.value = '';
  try {
    board.value = await admin.kanban(props.id);
    document.title = `Bewerbungen: ${board.value.job.title} – ${SITE_NAME}`;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status !== 401) loadError.value = e.status === 404 || e.status === 400 ? 'Stelle nicht gefunden.' : e.message;
  } finally {
    loading.value = false;
  }
}
watch(() => props.id, () => { loading.value = true; load(); }, { immediate: true });

const columns = computed(() => {
  if (!board.value) return [];
  return board.value.stages.map((stage) => ({
    ...stage,
    applications: board.value.applications.filter((a) => a.stage === stage.code),
  }));
});

const fullName = (a) => `${a.first_name} ${a.last_name}`;
const cardLinkId = (a) => `karte-${a.id}`;
const selectId = (a) => `ziel-${a.id}`;

function optionsFor(application) {
  return board.value.transitions[application.stage] ?? [];
}

async function move(application) {
  const target = targets[application.id];
  if (!target || busyId.value) return;
  const targetLabel = optionsFor(application).find((t) => t.code === target)?.label ?? target;
  busyId.value = application.id;
  statusMessage.value = '';
  errorMessage.value = '';
  try {
    await admin.changeStage(application.id, target);
    statusMessage.value = `${fullName(application)}: nach „${targetLabel}“ verschoben.`;
    delete targets[application.id];
    await load();
    await nextTick();
    document.getElementById(cardLinkId(application))?.focus(); // Fokus auf die Karte in der neuen Spalte
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status !== 401) {
      errorMessage.value = `${fullName(application)}: ${e.message}`;
      await load();
    }
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <p class="breadcrumb"><RouterLink :to="{ name: 'admin-jobs' }">← Zur Stellenverwaltung</RouterLink></p>

  <p v-if="loading">Bewerbungen werden geladen …</p>
  <template v-else-if="loadError">
    <h1>Bewerbungen</h1>
    <p class="message message--error">{{ loadError }}</p>
  </template>

  <template v-else-if="board">
    <h1>Bewerbungen: {{ board.job.title }}</h1>
    <p class="lead">
      {{ board.job.location }} · {{ jobStatusLabel(board.job.status) }} ·
      {{ board.applications.length }} {{ board.applications.length === 1 ? 'Bewerbung' : 'Bewerbungen' }}
    </p>

    <p class="form-status" role="status">{{ statusMessage }}</p>
    <p class="form-alert" role="alert">{{ errorMessage }}</p>

    <div class="kanban" role="region" aria-label="Pipeline nach Stufen" tabindex="0">
      <section v-for="column in columns" :key="column.code" class="kanban__column"
               :class="{ 'kanban__column--terminal': column.is_terminal }"
               :aria-labelledby="`spalte-${column.code}`">
        <h2 :id="`spalte-${column.code}`" class="kanban__title">
          {{ column.label }} <span class="kanban__count">({{ column.applications.length }})</span>
        </h2>
        <p v-if="!column.applications.length" class="kanban__empty">Keine Bewerbungen</p>
        <ul v-else class="kanban__cards">
          <li v-for="a in column.applications" :key="a.id" class="card">
            <h3 class="card__name">
              <RouterLink :id="cardLinkId(a)" :to="{ name: 'admin-application', params: { id: a.id } }">
                {{ fullName(a) }}
              </RouterLink>
            </h3>
            <p class="card__meta">Eingang {{ formatDate(a.created_at) }}</p>
            <p class="card__meta">{{ a.rating ? `Bewertung ${a.rating} von 5` : 'Nicht bewertet' }}</p>
            <form v-if="optionsFor(a).length" class="card__move" @submit.prevent="move(a)">
              <label :for="selectId(a)">Neue Stufe<span class="visually-hidden"> für {{ fullName(a) }}</span></label>
              <select :id="selectId(a)" v-model="targets[a.id]">
                <option :value="undefined" disabled>Bitte wählen</option>
                <option v-for="t in optionsFor(a)" :key="t.code" :value="t.code">
                  {{ t.label }}{{ t.is_terminal ? ' (Endstufe)' : '' }}
                </option>
              </select>
              <button type="submit" class="button button--small" :disabled="!targets[a.id] || busyId === a.id">
                Verschieben<span class="visually-hidden"> {{ fullName(a) }}</span>
              </button>
            </form>
          </li>
        </ul>
      </section>
    </div>
  </template>
</template>
