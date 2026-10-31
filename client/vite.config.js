import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/** Social previews and canonical tags use absolute URLs. VITE_SITE_URL may override the default apex domain at build time. */
const siteUrl = (mode) => (loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL || '').replace(/\/$/, '');
const siteUrlPlugin = () => ({
  name: 'famevote-site-url',
  transformIndexHtml: { order: 'pre', handler(html, ctx) {
    const url = siteUrl(ctx.server?.config.mode || process.env.NODE_ENV || 'production');
    return html.replace(/__SITE_URL__/g, url || 'https://www.famevote.online');
  } },
});

export default defineConfig({
  plugins: [react(), siteUrlPlugin()],
  // same-origin-allow-popups lets the Google sign-in popup talk back to this page (a stricter COOP blocks postMessage).
  server: { port: 5173, headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' }, proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } } },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Stable vendor chunks: they change rarely, so returning visitors keep them cached across deploys.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          if (/node_modules\/(react-router|react-router-dom|@remix-run)/.test(id)) return 'vendor-router';
          if (/node_modules\/(motion|framer-motion|motion-dom|motion-utils)/.test(id)) return 'vendor-motion';
          if (/node_modules\/(axios|follow-redirects|form-data)/.test(id)) return 'vendor-axios';
          return undefined;
        },
      },
    },
  },
});
