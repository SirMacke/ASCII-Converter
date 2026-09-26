import { defineConfig } from 'vite';

// The web preview lives in web/ and imports the core library from src/core.
// base: './' keeps asset URLs relative so the build works from any path
// (for example a GitHub Pages project site).
export default defineConfig({
  root: 'web',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
