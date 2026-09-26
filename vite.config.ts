import { defineConfig, loadEnv, type Plugin } from 'vite';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'coin-table:csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}

function shareImage(site: string | undefined): Plugin {
  return {
    name: 'coin-table:share-image',
    apply: 'build',
    transformIndexHtml: () => {
      if (!site) return [];
      const image = new URL('og.jpg', site).href;
      return [
        { tag: 'meta', attrs: { property: 'og:url', content: site }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:image', content: image }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'twitter:image', content: image }, injectTo: 'head' },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const raw = loadEnv(mode, '.', 'SITE_').SITE_URL;
  const site = raw ? raw.replace(/\/?$/, '/') : undefined;
  return {
    base: './',
    plugins: [contentSecurityPolicy(), shareImage(site)],
    server: { port: 5173, open: false },
    build: {
      target: 'es2022',
      // three.js is ~600 kB on its own; it lives in its own chunk so it caches across releases.
      chunkSizeWarningLimit: 700,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
          },
        },
      },
    },
  };
});
