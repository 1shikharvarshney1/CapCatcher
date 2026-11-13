import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Use WASM rollup to bypass Application Control policy on native .node binary
    alias: {
      'rollup/parseAst': '@rollup/wasm-node/parseAst'
    }
  },
  server: {
    proxy: {
      '/api': 'http://localhost:5001'
    }
  }
});
