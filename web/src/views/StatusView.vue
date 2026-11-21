<script setup>
// Statusseite über den persönlichen Link (UC4) mit Rückzug der Bewerbung (UC5).
// Rückzug mit Bestätigungsschritt auf der Seite (kein window.confirm).
import { nextTick, ref, watch } from 'vue';
import { fetchStatus, withdrawApplication } from '../api.js';
import { formatDate } from '../labels.js';

const props = defineProps({ token: { type: String, required: true } });

const INVALID_LINK = 'Dieser Status-Link ist ungültig oder die Bewerbung wurde bereits gelöscht.';

const status = ref(null);
const loading = ref(true);
const invalid = ref(false);
const loadError = ref('');

const confirming = ref(false);
const sending = ref(false);
const resultMessage = ref('');
const actionError = ref('');

const confirmQuestion = ref(null);
const withdrawButton = ref(null);

async function load() {
  loading.value = true;
  invalid.value = false;
  loadError.value = '';
  try {
    status.value = await fetchStatus(props.token);
  } catch (e) {
    if (e.status === 400 || e.status === 404) invalid.value = true;
    else loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

watch(() => props.token, load, { immediate: true });

async function startWithdraw() {
  actionError.value = '';
  confirming.value = true;
  await nextTick();
  confirmQuestion.value?.focus();
}

async function cancelWithdraw() {
  confirming.value = false;
  await nextTick();
  withdrawButton.value?.focus();
}

async function confirmWithdraw() {
  if (sending.value) return;
  sending.value = true;
  actionError.value = '';
  try {
    status.value = await withdrawApplication(props.token);
    confirming.value = false;
    resultMessage.value = 'Ihre Bewerbung wurde zurückgezogen.';
  } catch (e) {
    confirming.value = false;
    if (e.status === 400 || e.status === 404) {
      invalid.value = true;
    } else {
      actionError.value = e.message;
      if (e.status === 409) await load();
    }
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <h1>Status Ihrer Bewerbung</h1>

  <p v-if="loading" role="status">Status wird geladen …</p>

  <p v-else-if="invalid" class="message message--error" role="alert">{{ INVALID_LINK }}</p>

  <p v-else-if="loadError" class="message message--error" role="alert">{{ loadError }}</p>

  <template v-else-if="status">
    <p v-if="resultMessage" class="message message--success" role="status">{{ resultMessage }}</p>
    <p v-if="actionError" class="message message--error" role="alert">{{ actionError }}</p>

    <dl class="status-facts">
      <div>
        <dt>Stelle</dt>
        <dd>{{ status.job_title }}</dd>
      </div>
      <div>
        <dt>Aktueller Stand</dt>
        <dd>{{ status.stage_label }}</dd>
      </div>
      <div>
        <dt>Eingegangen am</dt>
        <dd><time :datetime="status.submitted_at">{{ formatDate(status.submitted_at) }}</time></dd>
      </div>
      <div v-if="status.delete_after">
        <dt>Automatische Löschung Ihrer Daten am</dt>
        <dd><time :datetime="status.delete_after">{{ formatDate(status.delete_after) }}</time></dd>
      </div>
    </dl>

    <template v-if="status.can_withdraw">
      <p v-if="!confirming">
        <button ref="withdrawButton" type="button" class="button button--secondary" @click="startWithdraw">
          Bewerbung zurückziehen
        </button>
      </p>
      <div v-else class="confirm-box" role="group" aria-labelledby="rueckzug-frage">
        <p id="rueckzug-frage" ref="confirmQuestion" tabindex="-1" class="confirm-box__question">
          Möchten Sie Ihre Bewerbung wirklich zurückziehen? Das kann nicht rückgängig gemacht werden.
        </p>
        <p class="confirm-box__actions">
          <button type="button" class="button button--danger" :disabled="sending" @click="confirmWithdraw">
            {{ sending ? 'Wird zurückgezogen …' : 'Ja, endgültig zurückziehen' }}
          </button>
          <button type="button" class="button button--secondary" :disabled="sending" @click="cancelWithdraw">
            Abbrechen
          </button>
        </p>
      </div>
    </template>
    <p v-else-if="!resultMessage">Das Verfahren ist abgeschlossen; ein Rückzug ist nicht mehr möglich.</p>
  </template>
</template>
