import { describe, it, expect } from 'vitest'
import { DEFAULT_PANEL_LAYOUT, clampNumber, isPanelLayout } from '../panelLayout'

describe('isPanelLayout', () => {
  it('既定値と範囲の両端を受け付ける', () => {
    expect(isPanelLayout(DEFAULT_PANEL_LAYOUT)).toBe(true)
    expect(isPanelLayout({ sidebarWidth: 220, terminalHeightPercent: 15 })).toBe(true)
    expect(isPanelLayout({ sidebarWidth: 600, terminalHeightPercent: 85 })).toBe(true)
  })

  it.each([
    [null],
    ['240'],
    [{ sidebarWidth: 219, terminalHeightPercent: 45 }],
    [{ sidebarWidth: 601, terminalHeightPercent: 45 }],
    [{ sidebarWidth: 240, terminalHeightPercent: 14 }],
    [{ sidebarWidth: 240, terminalHeightPercent: 86 }],
    [{ sidebarWidth: Number.NaN, terminalHeightPercent: 45 }],
    [{ sidebarWidth: 240 }]
  ])('%j は受け付けない', (value) => {
    expect(isPanelLayout(value)).toBe(false)
  })
})

describe('clampNumber', () => {
  it('範囲へ丸める', () => {
    expect(clampNumber(5, 10, 20)).toBe(10)
    expect(clampNumber(25, 10, 20)).toBe(20)
    expect(clampNumber(15, 10, 20)).toBe(15)
  })
})
