<script setup>
// Bewerbungsdetail (UC7–UC11): Personendaten, Anschreiben (nur als Text), Lebenslauf-Download,
// Bewertung, Stufenwechsel mit optionalem Kommentar, Notizen, Verlauf.
// Alle Inhalte werden per Interpolation ausgegeben – HTML im Anschreiben erscheint als Text.
import { computed, reactive, ref, watch } from 'vue';
import { ApiError, admin, attachmentUrl } from '../../api.js';
import { SITE_NAME, formatDate, formatDateTime, formatFileSize } from '../../labels.js';

const props = defineProps({ id: { type: String, required: true } });

const application = ref(null);
const loading = ref(true);
const loadError = ref('');

const rating = ref(null);
const stage = reactive({ target: '', comment: '' });
const noteBody = ref('');
// Rückmeldungen je Bereich: status = Erfolg (role="status"), alert = Fehler (role="alert")
const feedback = reactive({
  rating: { status: '', alert: '' },
  stage: { status: '', alert: '' },
  note: { status: '', alert: '' },
});
const busy = ref('');

const fullName = computed(() =>
  application.value ? `${application.value.first_name} ${application.value.last_name}` : '');

function show(app) {
  application.value = app;
  rating.value = app.rating;
  document.title = `${app.first_name} ${app.last_name} – Bewerbung – ${SITE_NAME}`;
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    show(await admin.getApplication(props.id));
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status !== 401) loadError.value = e.status === 404 || e.status === 400 ? 'Bewerbung nicht gefunden.' : e.message;
  } finally {
    loading.value = false;
  }
}
watch(() => props.id, load, { immediate: true });

// Führt eine Aktion aus und setzt die Rückmeldung des Bereichs.
async function run(area, action, successText) {
  if (busy.value) return false;
  busy.value = area;
  feedback[area].status = '';
  feedback[area].alert = '';
  try {
    await action();
    feedback[area].status = successText;
    return true;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status !== 401) feedback[area].alert = e.details?.[0]?.message ?? e.message;
    return false;
  } finally {
    busy.value = '';
  }
}

function saveRating() {
  if (!rating.value) {
    feedback.rating.alert = 'Bitte wählen Sie eine Bewertung von 1 bis 5.';
    return;
  }
  run('rating', async () => show(await admin.rate(props.id, rating.value)),
    `Bewertung ${rating.value} von 5 gespeichert.`);
}

async function changeStage() {
  if (!stage.target) {
    feedback.stage.alert = 'Bitte wählen Sie die neue Stufe.';
    return;
  }
  const label = application.value.allowed_targets.find((t) => t.code === stage.target)?.label ?? stage.target;
  const ok = await run('stage', async () => show(await admin.changeStage(props.id, stage.target, stage.comment)),
    `Die Bewerbung ist jetzt in der Stufe „${label}“.`);
  if (ok) {
    stage.target = '';
    stage.comment = '';
  } else {
    await load(); // Stand vom Server holen (z. B. inzwischen anderswo verschoben)
  }
}

async function addNote() {
  if (noteBody.value.trim() === '') {
    feedback.note.alert = 'Bitte geben Sie einen Notiztext ein.';
    return;
  }
  const ok = await run('note', async () => {
    const note = await admin.addNote(props.id, noteBody.value);
    application.value.notes.push(note);
  }, 'Notiz gespeichert.');
  if (ok) noteBody.value = '';
}
</script>

<template>
  <p v-if="loading">Bewerbung wird geladen …</p>
  <template v-else-if="loadError">
    <p class="breadcrumb"><RouterLink :to="{ name: 'admin-jobs' }">← Zur Stellenverwaltung</RouterLink></p>
    <h1>Bewerbung</h1>
    <p class="message message--error">{{ loadError }}</p>
  </template>

  <template v-else-if="application">
    <p class="breadcrumb">
      <RouterLink :to="{ name: 'admin-kanban', params: { id: application.job.id } }">
        ← Alle Bewerbungen: {{ application.job.title }}
      </RouterLink>
    </p>
    <h1>{{ fullName }}</h1>
    <p class="lead">
      Stufe: <strong>{{ application.stage_label }}</strong>
      <template v-if="application.rating"> · Bewertung {{ application.rating }} von 5</template>
    </p>

    <div class="detail-grid">
      <div class="detail-main">
        <section aria-labelledby="titel-daten">
          <h2 id="titel-daten">Angaben</h2>
          <dl class="detail-facts">
            <dt>Stelle</dt><dd>{{ application.job.title }}</dd>
            <dt>E-Mail-Adresse</dt><dd>{{ application.email }}</dd>
            <dt>Telefonnummer</dt><dd>{{ application.phone || '–' }}</dd>
            <dt>Eingegangen</dt><dd>{{ formatDateTime(application.created_at) }}</dd>
            <dt>Einwilligung</dt>
            <dd>{{ formatDateTime(application.consent_given_at) }} (Textversion {{ application.consent_version }})</dd>
            <template v-if="application.delete_after">
              <dt>Abgeschlossen</dt><dd>{{ formatDateTime(application.closed_at) }}</dd>
              <dt>Automatische Löschung</dt><dd>ab {{ formatDate(application.delete_after) }}</dd>
            </template>
          </dl>
        </section>

        <section aria-labelledby="titel-anschreiben">
          <h2 id="titel-anschreiben">Anschreiben</h2>
          <p v-if="application.cover_letter" class="cover-letter">{{ application.cover_letter }}</p>
          <p v-else class="hint">Kein Anschreiben.</p>
        </section>

        <section aria-labelledby="titel-lebenslauf">
          <h2 id="titel-lebenslauf">Lebenslauf</h2>
          <ul v-if="application.attachments.length" class="plain-list">
            <li v-for="att in application.attachments" :key="att.id">
              <a :href="attachmentUrl(att.id)" download>{{ att.original_filename }}</a>
              <span class="hint"> (PDF, {{ formatFileSize(att.size_bytes) }})</span>
            </li>
          </ul>
          <p v-else class="hint">Kein Lebenslauf vorhanden.</p>
        </section>

        <section aria-labelledby="titel-notizen">
          <h2 id="titel-notizen">Notizen</h2>
          <ul v-if="application.notes.length" class="note-list">
            <li v-for="n in application.notes" :key="n.id">
              <p class="note-list__meta">{{ n.author_name }} · {{ formatDateTime(n.created_at) }}</p>
              <p class="note-list__body">{{ n.body }}</p>
            </li>
          </ul>
          <p v-else class="hint">Noch keine Notizen.</p>
          <form class="stack-form" novalidate @submit.prevent="addNote">
            <div class="form-field">
              <label for="neue-notiz">Neue Notiz</label>
              <textarea id="neue-notiz" v-model="noteBody" rows="3" maxlength="5000"></textarea>
            </div>
            <p><button type="submit" class="button button--small" :disabled="busy === 'note'">Notiz speichern</button></p>
            <p class="form-status" role="status">{{ feedback.note.status }}</p>
            <p class="form-alert" role="alert">{{ feedback.note.alert }}</p>
          </form>
        </section>
      </div>

      <div class="detail-side">
        <section aria-labelledby="titel-stufe" class="panel">
          <h2 id="titel-stufe">Stufe ändern</h2>
          <form v-if="application.allowed_targets.length" class="stack-form" novalidate @submit.prevent="changeStage">
            <div class="form-field">
              <label for="neue-stufe">Neue Stufe (aktuell: {{ application.stage_label }})</label>
              <select id="neue-stufe" v-model="stage.target">
                <option value="" disabled>Bitte wählen</option>
                <option v-for="t in application.allowed_targets" :key="t.code" :value="t.code">
                  {{ t.label }}{{ t.is_terminal ? ' (Endstufe)' : '' }}
                </option>
              </select>
            </div>
            <div class="form-field">
              <label for="stufe-kommentar">Kommentar (optional)</label>
              <textarea id="stufe-kommentar" v-model="stage.comment" rows="2" maxlength="2000"></textarea>
            </div>
            <p><button type="submit" class="button button--small" :disabled="busy === 'stage'">Stufe ändern</button></p>
          </form>
          <p v-else class="hint">Die Bewerbung ist abgeschlossen (Endstufe); ein weiterer Wechsel ist nicht möglich.</p>
          <p class="form-status" role="status">{{ feedback.stage.status }}</p>
          <p class="form-alert" role="alert">{{ feedback.stage.alert }}</p>
        </section>

        <section aria-labelledby="titel-bewertung" class="panel">
          <h2 id="titel-bewertung">Bewertung</h2>
          <p v-if="application.is_terminal" class="hint">
            {{ application.rating ? `${application.rating} von 5` : 'Keine Bewertung' }} – die Bewerbung ist
            abgeschlossen; die Bewertung kann nicht mehr geändert werden.
          </p>
          <form v-else class="stack-form" novalidate @submit.prevent="saveRating">
            <fieldset class="rating">
              <legend>Bewertung von 1 (schwach) bis 5 (sehr gut)</legend>
              <label v-for="n in 5" :key="n" class="rating__option">
                <input v-model="rating" type="radio" name="bewertung" :value="n" /> {{ n }}
              </label>
            </fieldset>
            <p><button type="submit" class="button button--small" :disabled="busy === 'rating'">Bewertung speichern</button></p>
          </form>
          <p class="form-status" role="status">{{ feedback.rating.status }}</p>
          <p class="form-alert" role="alert">{{ feedback.rating.alert }}</p>
        </section>

        <section aria-labelledby="titel-verlauf" class="panel">
          <h2 id="titel-verlauf">Verlauf</h2>
          <ol class="history">
            <li>
              <span class="history__date">{{ formatDateTime(application.created_at) }}</span>
              Bewerbung eingegangen
            </li>
            <li v-for="h in application.history" :key="h.id">
              <span class="history__date">{{ formatDateTime(h.changed_at) }}</span>
              {{ h.from_label }} → {{ h.to_label }},
              durch {{ h.changed_by_name ?? 'Bewerber:in (Status-Link)' }}
              <span v-if="h.comment" class="history__comment">„{{ h.comment }}“</span>
            </li>
          </ol>
        </section>
      </div>
    </div>
  </template>
</template>
