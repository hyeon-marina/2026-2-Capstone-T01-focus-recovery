import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ publicDir: false, build: { outDir: 'dist-real', emptyOutDir: false,
  lib: { entry: resolve(import.meta.dirname, 'real/content.ts'), formats: ['iife'], name: 'ApprovedWebCollector', fileName: () => 'content.js' } } });
