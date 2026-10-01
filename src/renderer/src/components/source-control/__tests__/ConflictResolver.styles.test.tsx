import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { ConflictFile } from '@shared/types'
import ConflictResolver from '../ConflictResolver'
import { makeConflictFileState } from '../../../__tests__/makeConflictFileState'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// 「解決済みにする」は .conflict-resolver__button--primary で強調色(コミットボタンと同じ青)にする。
// jsdom は :hover を計算しないため、ホバー色は検証しない
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const both = { ours: true, theirs: true }

// ブロックが 0 件: 「解決済みにする」が押せる
const noBlocks: ConflictFile = {
  status: 'parsed',
  stages: both,
  eol: '\n',
  digests: [],
  segments: [{ kind: 'text', lines: ['残った内容'] }]
}

// ブロックが残る: 「解決済みにする」は disabled
const oneBlock: ConflictFile = {
  status: 'parsed',
  stages: both,
  eol: '\n',
  digests: ['d0'],
  segments: [
    {
      kind: 'conflict',
      ours: ['自分'],
      theirs: ['相手'],
      oursLabel: 'HEAD',
      theirsLabel: 'feature'
    }
  ]
}

describe('ConflictResolver のスタイル(main.css)', () => {
  it('「解決済みにする」は通常のボタンと違う強調の背景色・文字色になる', () => {
    render(
      <ConflictResolver isBlocked={false} conflict={makeConflictFileState({ file: noBlocks })} />
    )
    const primary = getComputedStyle(screen.getByRole('button', { name: '解決済みにする' }))
    const normal = getComputedStyle(screen.getByRole('button', { name: '自分をすべて採用' }))
    expect(primary.backgroundColor).toBe('rgb(14, 99, 156)')
    expect(primary.backgroundColor).not.toBe(normal.backgroundColor)
    expect(primary.color).toBe('rgb(255, 255, 255)')
    expect(primary.color).not.toBe(normal.color)
    // 寸法は通常のボタンと共通
    expect(primary.minWidth).toBe('32px')
    expect(primary.minHeight).toBe('32px')
  })

  it('disabled の「解決済みにする」は強調が残らず、通常のボタンの disabled と同じ見た目になる', () => {
    render(
      <ConflictResolver isBlocked={false} conflict={makeConflictFileState({ file: oneBlock })} />
    )
    const primary = getComputedStyle(screen.getByRole('button', { name: '解決済みにする' }))
    const normal = getComputedStyle(screen.getByRole('button', { name: '自分をすべて採用' }))
    expect(primary.backgroundColor).toBe(normal.backgroundColor)
    expect(primary.color).toBe(normal.color)
    expect(primary.opacity).toBe('0.5')
    expect(primary.cursor).toBe('default')
  })
})
