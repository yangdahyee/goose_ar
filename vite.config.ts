import { defineConfig } from 'vite';

// GitHub Pages serves the site at /<repo>/. The deploy workflow sets BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
});
