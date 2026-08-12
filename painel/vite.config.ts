import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    strictPort: false,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Separa o que raramente muda do codigo da aplicacao: o navegador
        // reaproveita o chunk de vendor entre deploys.
        //
        // O Supabase nao entra nesta lista de proposito. Em VITE_DATA_MODE=mock
        // o bundler consegue elimina-lo por completo (DATA_MODE vira literal em
        // tempo de build); fixa-lo num chunk proprio geraria um arquivo vazio.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
