<script setup>
// Nutzerverwaltung (UC12, nur Admin): interne Nutzer auflisten, anlegen (Startpasswort vom Admin),
// Rolle ändern, deaktivieren (mit Bestätigung auf der Seite) und reaktivieren. Das eigene Konto lässt
// sich hier nicht ändern. Maßgeblich sind die Prüfungen der API (Passwortregel, letzter Admin).
import { computed, nextTick, reactive, ref } from 'vue';
import { ApiError, admin } from '../../api.js';
import { ROLE_LABELS, formatDate, roleLabel } from '../../labels.js';
import { auth } from '../../auth.js';
import ErrorSummary from '../../components/ErrorSummary.vue';

const users = ref([]);
const loading = ref(true);
const loadError = ref('');
const statusMessage = ref('');
const errorMessage = ref('');
const busyId = ref(null);
const roleDraft = reactive({}); // gewählte Rolle je Nutzer-ID
const deactivating = ref(null);

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    users.value = await admin.listUsers();
    for (const u of users.value) roleDraft[u.id] = u.role;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status !== 401) loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}
load();

const isSelf = (user) => user.id === auth.user?.id;

async function runAction(user, action, successText) {
  busyId.value = user.id;
  statusMessage.value = '';
  errorMessage.value = '';
  try {
    await action();
    statusMessage.value = successText;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status !== 401) errorMessage.value = e.message;
  } finally {
    busyId.value = null;
    await load();
  }
}

function saveRole(user) {
  const role = roleDraft[user.id];
  return runAction(user, () => admin.setRole(user.id, role),
    `Die Rolle von „${user.display_name}“ ist jetzt „${roleLabel(role)}“.`);
}

function activate(user) {
  return runAction(user, () => admin.activateUser(user.id), `Das Konto von „${user.display_name}“ ist wieder aktiv.`);
}

async function askDeactivate(user) {
  deactivating.value = user;
  await nextTick();
  document.getElementById('deaktivieren-frage')?.focus();
}

async function cancelDeactivate() {
  const id = deactivating.value?.id;
  deactivating.value = null;
  await nextTick();
  document.getElementById(`deaktivieren-${id}`)?.focus();
}

async function confirmDeactivate() {
  const user = deactivating.value;
  deactivating.value = null;
  await runAction(user, () => admin.deactivateUser(user.id),
    `Das Konto von „${user.display_name}“ ist deaktiviert; offene Sitzungen sind beendet.`);
}

// --- Neues Konto ------------------------------------------------------------------------------
const FIELDS = { email: 'E-Mail-Adresse', display_name: 'Name', role: 'Rolle', password: 'Startpasswort' };
const values = reactive({ email: '', display_name: '', role: 'recruiter', password: '' });
const errors = ref({});
const general = ref([]);
const sending = ref(false);
const summary = ref(null);
const inputId = (field) => `nutzer-${field}`;
const errorId = (field) => `fehler-nutzer-${field}`;

const summaryItems = computed(() => [
  ...Object.keys(FIELDS).filter((f) => errors.value[f])
    .map((f) => ({ target: inputId(f), label: FIELDS[f], message: errors.value[f] })),
  ...general.value.map((message) => ({ message })),
]);

async function onCreate() {
  if (sending.value) return;
  errors.value = {};
  general.value = [];
  statusMessage.value = '';
  sending.value = true;
  try {
    const user = await admin.createUser({ ...values });
    statusMessage.value = `Das Konto für „${user.display_name}“ wurde angelegt. Bitte geben Sie das Startpasswort `
      + 'auf einem sicheren Weg weiter.';
    Object.assign(values, { email: '', display_name: '', role: 'recruiter', password: '' });
    await load();
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 401) return;
    const fieldErrors = {};
    const other = [];
    for (const d of e.details) {
      if (FIELDS[d.field]) fieldErrors[d.field] ??= d.message;
      else other.push(d.message);
    }
    if (e.code === 'EMAIL_TAKEN') fieldErrors.email = e.message;
    else if (!Object.keys(fieldErrors).length && !other.length) other.push(e.message);
    errors.value = fieldErrors;
    general.value = other;
    await nextTick();
    summary.value?.focus();
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <h1>Nutzerverwaltung</h1>

  <p class="form-status" role="status">{{ statusMessage }}</p>
  <p class="form-alert" role="alert">{{ errorMessage }}</p>

  <p v-if="loading && !users.length">Nutzer werden geladen …</p>
  <p v-else-if="loadError" class="message message--error">{{ loadError }}</p>

  <div v-else class="table-wrapper">
    <table class="data-table">
      <caption class="visually-hidden">Interne Nutzer mit Rolle und Status</caption>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Rolle</th>
          <th scope="col">Status</th>
          <th scope="col">Aktionen</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in users" :key="user.id">
          <td>
            {{ user.display_name }}
            <span class="cell-meta">{{ user.email }} · angelegt am {{ formatDate(user.created_at) }}</span>
          </td>
          <td>{{ roleLabel(user.role) }}</td>
          <td>
            <span class="badge" :class="user.is_active ? 'badge--published' : 'badge--closed'">
              {{ user.is_active ? 'Aktiv' : 'Deaktiviert' }}
            </span>
          </td>
          <td>
            <p v-if="isSelf(user)" class="cell-meta">Ihr Konto – hier nicht änderbar</p>
            <template v-else>
              <div class="actions">
                <label class="visually-hidden" :for="`rolle-${user.id}`">Rolle für „{{ user.display_name }}“</label>
                <select :id="`rolle-${user.id}`" v-model="roleDraft[user.id]" :disabled="busyId === user.id">
                  <option v-for="(label, code) in ROLE_LABELS" :key="code" :value="code">{{ label }}</option>
                </select>
                <button type="button" class="button button--small button--secondary"
                        :disabled="busyId === user.id || roleDraft[user.id] === user.role" @click="saveRole(user)">
                  Rolle speichern<span class="visually-hidden"> für „{{ user.display_name }}“</span>
                </button>
                <button v-if="user.is_active" :id="`deaktivieren-${user.id}`" type="button"
                        class="button button--small button--secondary" :disabled="busyId === user.id"
                        @click="askDeactivate(user)">
                  Deaktivieren<span class="visually-hidden"> „{{ user.display_name }}“</span>
                </button>
                <button v-else type="button" class="button button--small" :disabled="busyId === user.id"
                        @click="activate(user)">
                  Reaktivieren<span class="visually-hidden"> „{{ user.display_name }}“</span>
                </button>
              </div>
              <div v-if="deactivating?.id === user.id" class="confirm-box confirm-box--inline">
                <p id="deaktivieren-frage" class="confirm-box__question" tabindex="-1">
                  Konto „{{ user.display_name }}“ wirklich deaktivieren? Die Person kann sich nicht mehr anmelden;
                  eine offene Sitzung endet sofort.
                </p>
                <p class="confirm-box__actions">
                  <button type="button" class="button button--danger button--small" @click="confirmDeactivate">
                    Ja, deaktivieren
                  </button>
                  <button type="button" class="button button--secondary button--small" @click="cancelDeactivate">
                    Abbrechen
                  </button>
                </p>
              </div>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <section aria-labelledby="titel-neues-konto" class="panel">
    <h2 id="titel-neues-konto">Neues Konto anlegen</h2>
    <ErrorSummary ref="summary" :items="summaryItems" />
    <form class="application-form" novalidate @submit.prevent="onCreate">
      <div class="form-field">
        <label :for="inputId('email')">E-Mail-Adresse</label>
        <input :id="inputId('email')" v-model="values.email" type="email" autocomplete="off" required maxlength="254"
               :aria-invalid="errors.email ? 'true' : undefined"
               :aria-describedby="errors.email ? errorId('email') : undefined" />
        <p v-if="errors.email" :id="errorId('email')" class="field-error">{{ errors.email }}</p>
      </div>
      <div class="form-field">
        <label :for="inputId('display_name')">Name</label>
        <input :id="inputId('display_name')" v-model="values.display_name" type="text" required maxlength="100"
               :aria-invalid="errors.display_name ? 'true' : undefined"
               :aria-describedby="errors.display_name ? errorId('display_name') : undefined" />
        <p v-if="errors.display_name" :id="errorId('display_name')" class="field-error">{{ errors.display_name }}</p>
      </div>
      <div class="form-field">
        <label :for="inputId('role')">Rolle</label>
        <select :id="inputId('role')" v-model="values.role">
          <option v-for="(label, code) in ROLE_LABELS" :key="code" :value="code">{{ label }}</option>
        </select>
      </div>
      <div class="form-field">
        <label :for="inputId('password')">Startpasswort</label>
        <p id="hinweis-nutzer-password" class="hint">
          Mindestens 15 und höchstens 64 Zeichen; Leerzeichen, Umlaute und Sonderzeichen sind erlaubt, es gibt keine
          Vorgaben zu Ziffern oder Großbuchstaben. Nicht erlaubt: Teile von Name oder E-Mail-Adresse und naheliegende
          Wörter wie „Passwort“. Eine Wortfolge wie „grüne äpfel über brücken“ ist gut geeignet.
        </p>
        <input :id="inputId('password')" v-model="values.password" type="password" autocomplete="new-password"
               required
               :aria-invalid="errors.password ? 'true' : undefined"
               :aria-describedby="['hinweis-nutzer-password', errors.password ? errorId('password') : '']
                 .filter(Boolean).join(' ')" />
        <p v-if="errors.password" :id="errorId('password')" class="field-error">{{ errors.password }}</p>
      </div>
      <p><button type="submit" class="button" :disabled="sending">Konto anlegen</button></p>
    </form>
  </section>
</template>
