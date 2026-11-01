import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { useRef } from 'react'
import type { PanelLayout } from '@shared/panelLayout'
import { DEFAULT_PANEL_LAYOUT } from '@shared/panelLayout'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import { usePanelLayout } from '../usePanelLayout'

const mockGet = vi.mocked(settingsApi.getPanelLayout)
const mockSet = vi.mocked(settingsApi.setPanelLayout)
let consoleSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.resetAllMocks()
  mockSet.mockResolvedValue(undefined)
  consoleSpy = null
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('usePanelLayout', () => {
  it('読み込んだ値を反映する', async () => {
    mockGet.mockResolvedValueOnce({ sidebarWidth: 300, terminalHeightPercent: 60 })
    const { result } = renderHook(() => usePanelLayout())
    await waitFor(() =>
      expect(result.current.layout).toEqual({ sidebarWidth: 300, terminalHeightPercent: 60 })
    )
  })

  it('範囲の外の値は丸める', () => {
    mockGet.mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => usePanelLayout())
    act(() => result.current.changeSidebarWidth(9999))
    act(() => result.current.changeTerminalHeightPercent(1))
    expect(result.current.layout).toEqual({ sidebarWidth: 600, terminalHeightPercent: 15 })
  })

  it('読み込みの前に変えた項目だけ今の値を残す', async () => {
    let resolve: (value: PanelLayout) => void = () => undefined
    mockGet.mockReturnValueOnce(
      new Promise<PanelLayout>((r) => {
        resolve = r
      })
    )
    const { result } = renderHook(() => usePanelLayout())
    act(() => result.current.changeSidebarWidth(320))
    await act(async () => {
      resolve({ sidebarWidth: 300, terminalHeightPercent: 60 })
    })
    expect(result.current.layout).toEqual({ sidebarWidth: 320, terminalHeightPercent: 60 })
  })

  it('読み込みに失敗しても既定値のまま続ける', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const err = new Error('broken')
    mockGet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => usePanelLayout())
    await waitFor(() => expect(consoleSpy).toHaveBeenCalledOnce())
    expect(consoleSpy).toHaveBeenCalledWith('[usePanelLayout] load failed:', err)
    expect(result.current.layout).toEqual(DEFAULT_PANEL_LAYOUT)
  })

  it('丸めた後の値が同じなら描画し直さない', () => {
    mockGet.mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => {
      const renders = useRef(0)
      renders.current += 1
      return { state: usePanelLayout(), renders }
    })
    act(() => result.current.state.changeSidebarWidth(9999))
    const after = result.current.renders.current
    act(() => result.current.state.changeSidebarWidth(9999))
    expect(result.current.renders.current).toBe(after)
  })

  it('同じ tick の commit は新しい値を保存する', async () => {
    mockGet.mockResolvedValue({ ...DEFAULT_PANEL_LAYOUT })
    const { result } = renderHook(() => usePanelLayout())
    await act(async () => {})
    act(() => {
      result.current.changeSidebarWidth(320)
      result.current.commit()
    })
    expect(mockSet).toHaveBeenCalledExactlyOnceWith({
      sidebarWidth: 320,
      terminalHeightPercent: DEFAULT_PANEL_LAYOUT.terminalHeightPercent
    })
  })

  it('読み込みの前の commit は待ち、読み込んだ値と合わせて 1 回保存する', async () => {
    let resolveLoad: (layout: PanelLayout) => void = () => undefined
    mockGet.mockReturnValue(new Promise<PanelLayout>((resolve) => (resolveLoad = resolve)))
    const { result } = renderHook(() => usePanelLayout())
    act(() => {
      result.current.changeSidebarWidth(320)
      result.current.commit()
      result.current.commit()
    })
    expect(mockSet).not.toHaveBeenCalled()
    await act(async () => resolveLoad({ sidebarWidth: 300, terminalHeightPercent: 60 }))
    expect(mockSet).toHaveBeenCalledExactlyOnceWith({
      sidebarWidth: 320,
      terminalHeightPercent: 60
    })
  })

  it('読み込みの途中で外れたら、待っていた保存はしない', async () => {
    let resolveLoad: (layout: PanelLayout) => void = () => undefined
    mockGet.mockReturnValue(new Promise<PanelLayout>((resolve) => (resolveLoad = resolve)))
    const { result, unmount } = renderHook(() => usePanelLayout())
    act(() => result.current.commit())
    unmount()
    await act(async () => resolveLoad({ sidebarWidth: 300, terminalHeightPercent: 60 }))
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('読み込みの前の commit も、読み込みに失敗したら保存しない', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let rejectLoad: (reason: unknown) => void = () => undefined
    mockGet.mockReturnValue(new Promise<PanelLayout>((_, reject) => (rejectLoad = reject)))
    const { result } = renderHook(() => usePanelLayout())
    act(() => {
      result.current.changeSidebarWidth(320)
      result.current.commit()
    })
    await act(async () => rejectLoad(new Error('broken')))
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('読み込みに失敗したら保存しない(変えていない項目を既定値で上書きしない)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockRejectedValueOnce(new Error('broken'))
    const { result } = renderHook(() => usePanelLayout())
    await waitFor(() => expect(consoleSpy).toHaveBeenCalledOnce())
    act(() => {
      result.current.changeSidebarWidth(320)
      result.current.commit()
    })
    expect(mockSet).not.toHaveBeenCalled()
    expect(result.current.layout.sidebarWidth).toBe(320)
  })

  it('保存に失敗しても投げない', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const err = new Error('disk')
    mockGet.mockResolvedValue({ ...DEFAULT_PANEL_LAYOUT })
    mockSet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => usePanelLayout())
    await act(async () => {})
    act(() => result.current.commit())
    await waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith('[usePanelLayout] save failed:', err)
    )
  })
})
