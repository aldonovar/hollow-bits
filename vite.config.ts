import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// path: vite.config.ts
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './', // Critical for relative path loading in Electron/Tauri
    server: {
      port: 3000,
      strictPort: true, // Fail if port is busy
      host: '0.0.0.0',
    },
    build: {
      target: 'esnext', // Optimize for modern webviews
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: mode === 'development',
    },
    plugins: [react()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
