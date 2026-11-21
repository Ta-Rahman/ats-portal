// Vite-Konfiguration: baut die Vue-SPA nach dist/; im Dev-Server wird /api an die lokale Umgebung
// weitergeleitet – über nginx (web-Container), weil die API keinen eigenen Host-Port hat.
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8090' },
  },
});
