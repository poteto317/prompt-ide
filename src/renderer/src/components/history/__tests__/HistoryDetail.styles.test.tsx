import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import HistoryDetail from '../HistoryDetail'
import type { HistoryEntry } from '../../../types'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する(AgentTerminalPanel.styles.test.tsx と同じ流儀)
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const agentEntry: HistoryEntry = {
  id: 'h1',
  promptId: 'p1',
  promptTitle: '要約',
  promptContent: '送った全文',
  fileContent: null,
  toolId: 'claude',
  status: 'sent',
  resultText: null,
  errorMessage: null,
  executedAt: 1000,
  agent: {
    claudeSessionId: '11111111-1111-4111-8111-111111111111',
    tabLabel: 'claude 1',
    folderPath: '/w'
  }
}

describe('履歴の詳細の押せない理由のスタイル(main.css)', () => {
  it('再実行・このセッションで再開の押せない理由は、同じ余白・色・文字の大きさで出す', () => {
    const { container } = render(
      <HistoryDetail
        entry={agentEntry}
        actions={{
          rerun: { disabled: true, reason: '再実行できない理由' },
          resume: { disabled: true, reason: '再開できない理由' }
        }}
        onRerun={vi.fn()}
        onResume={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    const styleOf = (selector: string): CSSStyleDeclaration =>
      getComputedStyle(container.querySelector(selector) as HTMLElement)
    const rerun = styleOf('.history-detail__rerun-reason')
    const resume = styleOf('.history-detail__resume-reason')
    for (const style of [rerun, resume]) {
      expect(style.marginTop).toBe('4px')
      expect(style.marginBottom).toBe('4px')
      expect(style.color).toBe('rgb(150, 150, 150)')
      expect(style.fontSize).toBe('12px')
    }
  })
})

// 送る・送った全文を読むだけの枠の共通の見た目(main.css で .agent-send-confirm__body と 1 つの規則)
const expectReadOnlyBodyStyle = (style: CSSStyleDeclaration): void => {
  expect(style.overflow).toBe('auto')
  expect(style.paddingTop).toBe('8px')
  expect(style.backgroundColor).toBe('rgb(30, 30, 30)')
  expect(style.borderTopColor).toBe('rgb(60, 60, 60)')
  expect(style.color).toBe('rgb(212, 212, 212)')
  expect(style.fontSize).toBe('12px')
  expect(style.whiteSpace).toBe('pre-wrap')
}

describe('履歴の詳細の送った内容のスタイル(main.css)', () => {
  it('送った全文は送信前の確認の本文と同じ枠の見た目で、高さは 40vh まで(確認の本文の min-height は持たない)', () => {
    const { container } = render(
      <HistoryDetail
        entry={agentEntry}
        actions={{ rerun: { disabled: false, reason: null }, resume: null }}
        onRerun={vi.fn()}
        onResume={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    const sent = getComputedStyle(container.querySelector('.history-detail__sent') as HTMLElement)
    expectReadOnlyBodyStyle(sent)
    expect(sent.maxHeight).toBe('40vh')
    expect(sent.minHeight).not.toBe('6em')
  })

  it('送信前の確認の本文と送った全文の共通の宣言は同じ値になる', () => {
    const { container } = render(
      <>
        <pre className="agent-send-confirm__body">送る全文</pre>
        <pre className="history-detail__sent">送った全文</pre>
      </>
    )
    const confirm = getComputedStyle(
      container.querySelector('.agent-send-confirm__body') as HTMLElement
    )
    const sent = getComputedStyle(container.querySelector('.history-detail__sent') as HTMLElement)
    expectReadOnlyBodyStyle(confirm)
    expectReadOnlyBodyStyle(sent)
    expect(confirm.maxHeight).toBe('50vh')
    expect(confirm.minHeight).toBe('6em')
    expect(sent.maxHeight).toBe('40vh')
  })
})
