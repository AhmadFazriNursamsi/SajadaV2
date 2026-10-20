import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: Vite di :5173 dengan proxy /api → API :3000. Produksi: API melayani dist ini di port yang sama.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', xfwd: true }, '/m': { target: process.env.API_URL ?? 'http://localhost:3000' } } },
  build: { outDir: 'dist', sourcemap: false },
});
