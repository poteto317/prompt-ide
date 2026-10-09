import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// renderer の共通の型(types.ts)は lib から読まれる側で、lib・hooks・components に依存しない(依存の向き)。
// lib の型を含む状態の型(ステータスバーの AgentStatusBarState など)は、組み立てる hook の側に置く

/** 依存の向きに反する import の指定子(相対パス `./…` と別名 `@renderer/…` の両方) */
const FORBIDDEN = /^(?:\.\/|@renderer\/)(lib|hooks|components)\//

/** ソースの import・export の指定子を取り出す */
const importSpecifiers = (source: string): string[] =>
  [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])

/** 指定子の配列から、依存の向きに反するものを返す */
const dependencyViolations = (specifiers: readonly string[]): string[] =>
  specifiers.filter((specifier) => FORBIDDEN.test(specifier))

describe('dependencyViolations', () => {
  it.each([
    './lib/agentActivity',
    './hooks/useAgentStatusBar',
    './components/StatusBar',
    '@renderer/lib/agentActivity',
    '@renderer/hooks/useAgentStatusBar',
    '@renderer/components/StatusBar'
  ])('%s は違反として検出する', (specifier) => {
    expect(dependencyViolations([specifier])).toEqual([specifier])
  })

  it.each(['react', '@shared/types', './types', '@renderer/types', '../lib/agentActivity'])(
    '%s は違反にしない',
    (specifier) => {
      expect(dependencyViolations([specifier])).toEqual([])
    }
  )

  it('ソースの import type の指定子も取り出す', () => {
    const source = "import type { AgentActivity } from '@renderer/lib/agentActivity'\n"
    expect(dependencyViolations(importSpecifiers(source))).toEqual(['@renderer/lib/agentActivity'])
  })
})

describe('types.ts の依存の向き', () => {
  it('lib・hooks・components を import しない', () => {
    const source = readFileSync(resolve(__dirname, '../types.ts'), 'utf-8')
    expect(dependencyViolations(importSpecifiers(source))).toEqual([])
  })
})
