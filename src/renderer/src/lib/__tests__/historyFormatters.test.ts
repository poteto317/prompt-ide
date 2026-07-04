import { describe, it, expect } from 'vitest'
import { EXECUTION_TOOLS } from '@shared/types'
import { getToolLabel, formatExecutedAt, getStatusLabel } from '../historyFormatters'

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
})
