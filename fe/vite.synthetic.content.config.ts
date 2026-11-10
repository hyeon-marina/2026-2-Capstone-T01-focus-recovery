import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ publicDir: false, build: { outDir: 'dist-synthetic', emptyOutDir: false,
  lib: { entry: resolve(import.meta.dirname, 'synthetic/content.ts'), formats: ['iife'], name: 'SyntheticCollector', fileName: () => 'content.js' } } });
