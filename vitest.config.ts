import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentMatchGlobs: [['src/main/**', 'node']],
    globals: true,
    setupFiles: ['./src/renderer/src/__tests__/setup.ts'],
    include: [
      'src/renderer/src/**/*.test.{ts,tsx}',
      'src/main/**/*.test.ts',
      'src/shared/**/*.test.ts',
      'src/preload/**/*.test.ts'
    ],
    alias: {
      '@monaco-editor/react': resolve(
        __dirname,
        'src/renderer/src/__tests__/__mocks__/@monaco-editor/react.tsx'
      )
    },
    forks: {
      maxForks: 5
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/__tests__/**',
        '**/__mocks__/**',
        '**/index.ts',
        '**/types.ts',
        'src/shared/types/**'
      ]
    }
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
