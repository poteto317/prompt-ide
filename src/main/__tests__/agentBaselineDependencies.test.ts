import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 記録の部品の依存の向き(設計書 2026-10-15。SRP リファクタリング第 2 周)。上位の方針(記録の手順・方式の判定・registry)が下位の詳細
// (git の起動・環境変数・一時ディレクトリの名前)を使い、逆向きの import(型だけのものも含む)を持たないことを、ソースの import 文で確かめる

const MAIN_DIR = join(__dirname, '..')

// ファイルが import する同じ階層のモジュール名('./x' の x)。import type も含める
function localImportsOf(fileName: string): string[] {
  const source = readFileSync(join(MAIN_DIR, fileName), 'utf8')
  return [...source.matchAll(/from '\.\/([^']+)'/g)].map((match) => match[1])
}

describe('記録の部品の依存の向き', () => {
  it('localImportsOf は import と import type の両方の同じ階層のモジュールを拾う', () => {
    expect(localImportsOf('agentBaselineHiddenGit.ts')).toEqual([
      'agentBaselineGit',
      'agentBaselineGit'
    ])
  })

  it('git の起動の層(agentBaselineGit)は、同じ階層のどのモジュールも import しない(記録の手順・方式の判定・registry を型でも参照しない)', () => {
    expect(localImportsOf('agentBaselineGit.ts')).toEqual([])
  })

  it('隠れた git の作成(agentBaselineHiddenGit)は git の起動の層だけを使う', () => {
    expect(new Set(localImportsOf('agentBaselineHiddenGit.ts'))).toEqual(
      new Set(['agentBaselineGit'])
    )
  })

  it('一時ディレクトリの名前と起動時の掃除(agentBaselineTempSweep)は、同じ階層のどのモジュールも import しない', () => {
    expect(localImportsOf('agentBaselineTempSweep.ts')).toEqual([])
  })

  it('方式の判定(agentBaselineMode)は、記録の手順・隠れた git の作成・掃除・registry を import しない(記録の手順 → 方式の判定の一方向)', () => {
    const imports = localImportsOf('agentBaselineMode.ts')
    for (const upperOrSibling of [
      'agentBaselineSnapshot',
      'agentBaselineHiddenGit',
      'agentBaselineTempSweep',
      'agentBaselineRegistry'
    ]) {
      expect(imports).not.toContain(upperOrSibling)
    }
  })

  it('リポジトリの判定(gitRepoDetection)は、記録の部品(agentBaseline*)を import しない', () => {
    expect(
      localImportsOf('gitRepoDetection.ts').filter((name) => name.startsWith('agentBaseline'))
    ).toEqual([])
  })
})
