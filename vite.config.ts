import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Rapier (compat) incluye el wasm embebido, el bundle principal pesa ~2 MB.
  build: { chunkSizeWarningLimit: 3000 },
});
