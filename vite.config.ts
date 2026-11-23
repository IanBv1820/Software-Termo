import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps asset paths relative so the same build works when it is
// wrapped as a desktop app (Tauri/Electron) or served from a sub-folder.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['coolprop-wasm'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', testTimeout: 30000 },
} as any);
