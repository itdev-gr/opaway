// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.opawey.com',
  devToolbar: { enabled: false },
  integrations: [
    sitemap({
      filter: (page) => {
        // Exclude dashboards entirely
        if (/\/(admin|driver|hotel|agency|profile)(\/|$)/.test(page)) return false;
        // Exclude multi-step booking flow pages (passenger/payment/results)
        if (/\/book\/[^/]+\/(passenger|payment|results)\/?$/.test(page)) return false;
        // Exclude auth / utility / partner-register
        if (/\/(login|register|register-partner|forgot-password|logout|404)\/?$/.test(page)) return false;
        return true;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});
