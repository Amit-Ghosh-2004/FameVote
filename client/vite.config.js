import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/** Social previews need absolute URLs. Set VITE_SITE_URL (your public site) at build time; without it the tags fall back to relative paths and the canonical/og:url tags are dropped. */
const siteUrl = (mode) => (loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL || '').replace(/\/$/, '');
const siteUrlPlugin = () => ({
  name: 'famevote-site-url',
  transformIndexHtml: { order: 'pre', handler(html, ctx) {
    const url = siteUrl(ctx.server?.config.mode || process.env.NODE_ENV || 'production');
    return (url ? html : html.replace(/^.*data-site-url.*\n/gm, '')).replace(/__SITE_URL__/g, url);
  } },
});

export default defineConfig({
  plugins: [react(), siteUrlPlugin()],
  // same-origin-allow-popups lets the Google sign-in popup talk back to this page (a stricter COOP blocks postMessage).
  server: { port: 5173, headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' }, proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } } },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
});
