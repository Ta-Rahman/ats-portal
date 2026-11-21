// Client-Routen der Karriereseite: UC1 Stellenliste, UC2 Stellendetail, UC3 Bewerbung,
// UC4/UC5 Status-Link mit Rückzug; interner Bereich unter /intern (UC6–UC11, Anmeldung nötig).
import { createRouter, createWebHistory } from 'vue-router';
import { nextTick } from 'vue';
import HomeView from './views/HomeView.vue';
import JobListView from './views/JobListView.vue';
import JobDetailView from './views/JobDetailView.vue';
import ApplyView from './views/ApplyView.vue';
import StatusView from './views/StatusView.vue';
import NotFoundView from './views/NotFoundView.vue';
import LoginView from './views/LoginView.vue';
import JobsAdminView from './views/admin/JobsAdminView.vue';
import JobFormView from './views/admin/JobFormView.vue';
import KanbanView from './views/admin/KanbanView.vue';
import ApplicationDetailView from './views/admin/ApplicationDetailView.vue';
import UsersAdminView from './views/admin/UsersAdminView.vue';
import DeletionLogView from './views/admin/DeletionLogView.vue';
import { SITE_NAME } from './labels.js';
import { auth, loadMe, safeReturnPath } from './auth.js';

// Interne Seiten: area 'intern' (eigene Navigation), requiresAuth (Router-Guard unten).
const intern = (title, extra = {}) => ({ title, area: 'intern', requiresAuth: true, ...extra });

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Karriere' } },
    { path: '/stellen', name: 'jobs', component: JobListView, meta: { title: 'Offene Stellen' } },
    { path: '/stellen/:id', name: 'job', component: JobDetailView, props: true, meta: { title: 'Stelle' } },
    {
      path: '/stellen/:id/bewerben',
      name: 'apply',
      component: ApplyView,
      props: true,
      meta: { title: 'Bewerbung' },
    },
    {
      path: '/status/:token',
      name: 'status',
      component: StatusView,
      props: true,
      meta: { title: 'Status Ihrer Bewerbung' },
    },
    { path: '/intern', redirect: '/intern/stellen' },
    {
      path: '/intern/anmelden',
      name: 'login',
      component: LoginView,
      meta: { title: 'Anmeldung', area: 'intern' },
    },
    { path: '/intern/stellen', name: 'admin-jobs', component: JobsAdminView, meta: intern('Stellenverwaltung') },
    { path: '/intern/stellen/neu', name: 'admin-job-new', component: JobFormView, meta: intern('Neue Stelle') },
    {
      path: '/intern/stellen/:id/bearbeiten',
      name: 'admin-job-edit',
      component: JobFormView,
      props: true,
      meta: intern('Stelle bearbeiten'),
    },
    {
      path: '/intern/stellen/:id/bewerbungen',
      name: 'admin-kanban',
      component: KanbanView,
      props: true,
      meta: intern('Bewerbungen'),
    },
    {
      path: '/intern/bewerbungen/:id',
      name: 'admin-application',
      component: ApplicationDetailView,
      props: true,
      meta: intern('Bewerbung'),
    },
    // nur Admin (Iteration 4); die eigentliche Prüfung macht die API (403)
    {
      path: '/intern/nutzer',
      name: 'admin-users',
      component: UsersAdminView,
      meta: intern('Nutzerverwaltung', { adminOnly: true }),
    },
    {
      path: '/intern/loeschprotokoll',
      name: 'admin-deletion-log',
      component: DeletionLogView,
      meta: intern('Löschprotokoll', { adminOnly: true }),
    },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView, meta: { title: 'Seite nicht gefunden' } },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

// Routenschutz: Interne Seiten nur mit Sitzung. Ohne Sitzung (GET /api/auth/me → 401) geht es zur
// Anmeldung; die angefragte Seite wird als ?weiter=… mitgegeben und danach geöffnet. Die
// eigentliche Prüfung macht die API bei jeder Anfrage – der Guard verhindert nur leere Seiten.
router.beforeEach(async (to) => {
  if (to.name === 'login') {
    if (!auth.checked) await loadMe();
    return auth.user ? safeReturnPath(to.query.weiter) : true;
  }
  if (!to.meta.requiresAuth) return true;
  if (!auth.user) await loadMe();
  if (!auth.user) return { name: 'login', query: { weiter: to.fullPath } };
  // Seiten nur für Admins: Recruiter landen in der Stellenverwaltung (die API antwortet ohnehin 403).
  if (to.meta.adminOnly && auth.user.role !== 'admin') return { name: 'admin-jobs' };
  return true;
});

// Seitentitel setzen und – nach einem Seitenwechsel innerhalb der SPA – den Fokus auf den
// Hauptinhalt legen, damit Screenreader und Tastatur am Anfang der neuen Seite starten.
router.afterEach((to, from) => {
  document.title = `${to.meta.title ?? 'Karriere'} – ${SITE_NAME}`;
  const pageChanged = from.matched.length > 0 && to.path !== from.path;
  if (pageChanged) {
    nextTick(() => document.getElementById('main')?.focus());
  }
});
