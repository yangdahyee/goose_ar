import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

// The deploy workflow passes the commit in GITHUB_SHA. Locally it is "dev".
const BUILD_ID = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7);

// GitHub Pages serves the site at /<repo>/. The deploy workflow sets BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: { target: 'es2022' }, // top-level await
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    {
      // version.json lets an already-open (possibly cached) page find out whether a newer build exists.
      name: 'version-json',
      apply: 'build',
      closeBundle() {
        mkdirSync('dist', { recursive: true });
        writeFileSync(join('dist', 'version.json'), JSON.stringify({ id: BUILD_ID }));
      },
    },
  ],
});
