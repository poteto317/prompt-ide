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
      'src/preload/**/*.test.ts',
      'scripts/**/*.test.mjs'
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
        '**/*.d.ts',
        'src/shared/types/**',
        // Monaco Editor のブートストラップコード。
        // Worker の設定と loader.config を行うグローバル初期化のみで、
        // jsdom / Node.js 環境ではテスト不可能なため除外する
        'src/renderer/src/lib/monaco-config.ts',
        // レンダラープロセスのエントリーポイント（createRootによるマウントのみ）
        'src/renderer/src/main.tsx',
        // stageMachine.ts はバレルファイル（stageTransitions / stageNavigation の re-export のみ）。
        // 各モジュールは個別テストで完全にカバー済みのため除外する
        'src/renderer/src/lib/stageMachine.ts'
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
