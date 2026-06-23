import { describe, it, expect } from 'vitest'
import type { Prompt } from '@shared/types'
import { buildExport, parseImport } from '../promptTransfer'

const samplePrompt: Prompt = {
  id: 'p1',
  title: 'タイトル',
  content: 'コンテンツ',
  createdAt: 1000000,
}

describe('buildExport', () => {
  it('kind / version / exportedAt / prompts を持つエンベロープを生成する', () => {
    const result = buildExport([samplePrompt])
    expect(result.kind).toBe('prompt-ide/prompts')
    expect(result.version).toBe(1)
    expect(typeof result.exportedAt).toBe('number')
    expect(result.prompts).toEqual([samplePrompt])
  })

  it('prompts を sanitize して余分なプロパティを落とす', () => {
    const withExtra = { ...samplePrompt, extra: 'remove me' } as unknown as Prompt
    const result = buildExport([withExtra])
    expect(result.prompts).toEqual([samplePrompt])
  })

  it('空配列でもエンベロープを生成する', () => {
    const result = buildExport([])
    expect(result.prompts).toEqual([])
  })
})

describe('parseImport', () => {
  it('エンベロープ形式から prompts を取り出す', () => {
    const raw = JSON.stringify(buildExport([samplePrompt]))
    expect(parseImport(raw)).toEqual([samplePrompt])
  })

  it('素の配列形式も受理する（後方互換）', () => {
    const raw = JSON.stringify([samplePrompt])
    expect(parseImport(raw)).toEqual([samplePrompt])
  })

  it('不正な要素は除外し、正しい要素だけを返す', () => {
    const raw = JSON.stringify([samplePrompt, { id: 123, title: 'x' }, null])
    expect(parseImport(raw)).toEqual([samplePrompt])
  })

  it('余分なプロパティは sanitize で落とす', () => {
    const raw = JSON.stringify([{ ...samplePrompt, extra: 'x' }])
    expect(parseImport(raw)).toEqual([samplePrompt])
  })

  it('pinned が boolean のとき保持される', () => {
    const pinned = { ...samplePrompt, pinned: true }
    const raw = JSON.stringify([pinned])
    expect(parseImport(raw)).toEqual([pinned])
  })

  it('kind が一致しないオブジェクトは空配列を返す', () => {
    const raw = JSON.stringify({ kind: 'other', prompts: [samplePrompt] })
    expect(parseImport(raw)).toEqual([])
  })

  it('version が 1 でないエンベロープは空配列を返す（未知バージョンの誤読み込み防止）', () => {
    const raw = JSON.stringify({ kind: 'prompt-ide/prompts', version: 2, prompts: [samplePrompt] })
    expect(parseImport(raw)).toEqual([])
  })

  it('version が欠落しているエンベロープは空配列を返す', () => {
    const raw = JSON.stringify({ kind: 'prompt-ide/prompts', prompts: [samplePrompt] })
    expect(parseImport(raw)).toEqual([])
  })

  it('prompts が配列でないエンベロープは空配列を返す', () => {
    const raw = JSON.stringify({ kind: 'prompt-ide/prompts', version: 1, prompts: 'x' })
    expect(parseImport(raw)).toEqual([])
  })

  it('壊れた JSON のとき空配列を返す', () => {
    expect(parseImport('{ broken')).toEqual([])
  })
})
