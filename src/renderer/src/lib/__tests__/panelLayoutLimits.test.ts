import { describe, it, expect } from 'vitest'
import { sidebarWidthLimits, terminalHeightLimits } from '../panelLayoutLimits'

describe('sidebarWidthLimits', () => {
  it('エディタの領域とアクティビティバーの分を残す', () => {
    expect(sidebarWidthLimits(700)).toEqual({ min: 220, max: 300 })
  })

  it('広いウィンドウでは 600 まで、狭いウィンドウでは 220 に揃える', () => {
    expect(sidebarWidthLimits(1920)).toEqual({ min: 220, max: 600 })
    expect(sidebarWidthLimits(400)).toEqual({ min: 220, max: 220 })
  })
})

describe('terminalHeightLimits', () => {
  it('パネルの最小の高さ 160px が 15% を上回るなら下限を上げる', () => {
    expect(terminalHeightLimits(778)).toEqual({ min: 21, max: 85 })
  })

  it('エディタの領域が十分に高ければ 15% のまま', () => {
    expect(terminalHeightLimits(2000)).toEqual({ min: 15, max: 85 })
  })

  it('エディタの領域がとても低いときも下限は上限を超えない', () => {
    expect(terminalHeightLimits(100)).toEqual({ min: 85, max: 85 })
  })

  it('高さが 0 なら既定の範囲', () => {
    expect(terminalHeightLimits(0)).toEqual({ min: 15, max: 85 })
  })
})
