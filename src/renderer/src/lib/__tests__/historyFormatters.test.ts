import { describe, it, expect } from 'vitest'
import { EXECUTION_TOOLS } from '@shared/types'
import {
  getToolLabel,
  formatExecutedAt,
  getStatusLabel,
  getHistoryToolLabel,
  getHistoryPreviewSource
} from '../historyFormatters'

describe('getToolLabel', () => {
  it('既知の toolId のときラベルを返す', () => {
    const [tool] = EXECUTION_TOOLS
    expect(getToolLabel(tool.id)).toBe(tool.label)
  })

  it('未知の toolId のとき生の id にフォールバックする', () => {
    expect(getToolLabel('unknown-tool' as never)).toBe('unknown-tool')
  })
})

describe('formatExecutedAt', () => {
  it('タイムスタンプを toLocaleString と同じ文字列に整形する', () => {
    const timestamp = 1700000000000
    expect(formatExecutedAt(timestamp)).toBe(new Date(timestamp).toLocaleString())
  })
})

describe('getStatusLabel', () => {
  it('success のとき「成功」を返す', () => {
    expect(getStatusLabel('success')).toBe('成功')
  })

  it('error のとき「エラー」を返す', () => {
    expect(getStatusLabel('error')).toBe('エラー')
  })

  it('sent のとき「送信済み」を返す(結果を知らないので成功と出さない)', () => {
    expect(getStatusLabel('sent')).toBe('送信済み')
  })
})

describe('getHistoryToolLabel', () => {
  it('エージェントのエントリはタブ名付きの「エージェント（claude 2）」、従来のエントリはツール名', () => {
    expect(
      getHistoryToolLabel({
        toolId: 'claude',
        agent: {
          claudeSessionId: '11111111-1111-4111-8111-111111111111',
          cliKind: 'claude',
          tabLabel: 'claude 2',
          folderPath: '/w'
        }
      })
    ).toBe('エージェント（claude 2）')
    expect(getHistoryToolLabel({ toolId: 'claude', agent: null })).toBe(getToolLabel('claude'))
  })
})

describe('getHistoryPreviewSource', () => {
  const base = { promptContent: '送った全文', resultText: '結果', errorMessage: 'エラー' }

  it('sent は結果ではなく送った全文', () => {
    expect(getHistoryPreviewSource({ ...base, status: 'sent' })).toBe('送った全文')
  })

  it('success は結果を優先する', () => {
    expect(getHistoryPreviewSource({ ...base, status: 'success' })).toBe('結果')
  })

  it('結果が無ければエラー、どちらも無ければ空文字', () => {
    expect(getHistoryPreviewSource({ ...base, status: 'error', resultText: null })).toBe('エラー')
    expect(
      getHistoryPreviewSource({ ...base, status: 'error', resultText: null, errorMessage: null })
    ).toBe('')
  })
})
