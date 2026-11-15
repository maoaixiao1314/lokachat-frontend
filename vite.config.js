import {defineConfig} from 'vite';

// `/api/twin` goes to the twin backend with the prefix stripped: twin.ts refuses a
// cross-origin base, so the twin has to look same-origin even while it runs on its own port.
// Everything else under `/api` still belongs to the account/points backend.
const TWIN = process.env.TWIN_ORIGIN || 'http://127.0.0.1:8781';
const API = process.env.API_ORIGIN || 'http://127.0.0.1:8780';

export default defineConfig({
  server: {
    proxy: {
      '/api/twin': {target: TWIN, changeOrigin: true, rewrite: p => p.replace(/^\/api\/twin/, '')},
      '/api': API,
    },
  },
});
