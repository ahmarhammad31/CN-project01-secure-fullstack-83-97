import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The production build is a folder of static files (dist/) that Nginx on VM1
// serves from /var/www/app. The app never talks to a host name of its own: it
// calls relative /api/v1/... URLs, so the browser sends them to whatever origin
// served the page (VM1 over HTTPS). Nginx then proxies /api/ to VM2.
//
// In local development there is no Nginx, so the Vite dev server plays its role
// and proxies /api to the backend (the mock on port 8000 for now, the real
// Express API later). Because the proxy keeps everything on one origin,
// same-origin cookies and SameSite=Strict behave exactly as they do on VM1.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1, not localhost: it forces IPv4 and avoids the ::1 surprise.
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
  // `npm run preview` serves the real dist/ output, so the build that goes to
  // VM1 can be checked locally. It needs the same proxy, because preview does
  // not inherit the dev server's.
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
