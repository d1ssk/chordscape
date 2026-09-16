import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'audio', test: /node_modules\/tone/ }],
        },
      },
    },
  },
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
});
