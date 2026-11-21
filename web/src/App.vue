<script setup>
// Rahmen der SPA: öffentliche Navigation (Karriereseite) bzw. interne Navigation mit
// angemeldeter Person und Abmelden (Seiten mit meta.area = 'intern').
// Kopfzeile: Logo von Clear Cut Solutions als Marke der Portal-Software (Datei aus web/public/marke/,
// unverändert) und Name des Portals; der fiktive Arbeitgeber steht im Inhalt und im Seitentitel.
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { auth, logout } from './auth.js';

const route = useRoute();
const router = useRouter();
const isIntern = computed(() => route.meta.area === 'intern');

async function onLogout() {
  try {
    await logout();
  } finally {
    await router.push({ name: 'login', query: { abgemeldet: '1' } });
  }
}
</script>

<template>
  <a class="skip-link" href="#main">Zum Inhalt springen</a>
  <header class="site-header" :class="{ 'site-header--intern': isIntern }">
    <div class="container site-header__inner" :class="{ 'container--wide': isIntern }">
      <div class="site-brand">
        <img class="site-brand__logo" src="/marke/lockup-horizontal.svg" alt="Clear Cut Solutions" width="243" height="32" />
        <RouterLink v-if="isIntern" class="site-name" to="/intern/stellen">Bewerbermanagement</RouterLink>
        <RouterLink v-else class="site-name" to="/">Karriereportal</RouterLink>
      </div>
      <template v-if="isIntern">
        <nav v-if="auth.user" aria-label="Interne Navigation">
          <ul class="nav-list">
            <li><RouterLink to="/intern/stellen">Stellen</RouterLink></li>
            <template v-if="auth.user.role === 'admin'">
              <li><RouterLink to="/intern/nutzer">Nutzer</RouterLink></li>
              <li><RouterLink to="/intern/loeschprotokoll">Löschprotokoll</RouterLink></li>
            </template>
            <li class="nav-user">Angemeldet: {{ auth.user.display_name }}</li>
            <li><button type="button" class="link-button" @click="onLogout">Abmelden</button></li>
          </ul>
        </nav>
      </template>
      <template v-else>
        <nav aria-label="Hauptnavigation">
          <ul class="nav-list">
            <li><RouterLink to="/">Start</RouterLink></li>
            <li><RouterLink to="/stellen">Offene Stellen</RouterLink></li>
          </ul>
        </nav>
      </template>
    </div>
  </header>
  <main id="main" class="container" :class="{ 'container--wide': isIntern }" tabindex="-1">
    <RouterView />
  </main>
  <footer class="site-footer">
    <div class="container" :class="{ 'container--wide': isIntern }">
      <p>Fiktives Unternehmen im Rahmen eines Studienprojekts. Alle Stellen und Daten sind synthetisch.</p>
      <p>Portal-Software und Gestaltung: Clear Cut Solutions</p>
    </div>
  </footer>
</template>
