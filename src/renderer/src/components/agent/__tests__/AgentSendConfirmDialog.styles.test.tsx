import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

describe('AgentSendConfirmDialog のスタイル(main.css)', () => {
  it('引数欄は本文の枠と同じ背景・枠・文字色・文字サイズ', () => {
    const body = document.createElement('pre')
    body.className = 'agent-send-confirm__body'
    const input = document.createElement('input')
    input.className = 'agent-send-confirm__argument'
    document.body.append(body, input)
    try {
      const a = getComputedStyle(body)
      const b = getComputedStyle(input)
      for (const prop of ['backgroundColor', 'borderTopColor', 'color', 'fontSize'] as const) {
        expect(b[prop]).toBe(a[prop])
      }
    } finally {
      body.remove()
      input.remove()
    }
  })
})
