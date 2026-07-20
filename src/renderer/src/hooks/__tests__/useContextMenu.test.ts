import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { FileTreeNode } from '../../types'
import { useContextMenu } from '../useContextMenu'

const fileNode: FileTreeNode = { name: 'index.ts', path: '/p/index.ts', type: 'file' }

function makeMouseEvent(): React.MouseEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    clientX: 120,
    clientY: 240
  } as unknown as React.MouseEvent
}

describe('useContextMenu', () => {
  it('初期状態では menu が null', () => {
    const { result } = renderHook(() => useContextMenu())
    expect(result.current.menu).toBeNull()
  })

  it('openMenu でクリック座標とノードがセットされる', () => {
    const { result } = renderHook(() => useContextMenu())
    act(() => {
      result.current.openMenu(makeMouseEvent(), fileNode)
    })
    expect(result.current.menu).toEqual({ x: 120, y: 240, node: fileNode })
  })

  it('openMenu は preventDefault と stopPropagation を呼ぶ(ブラウザ既定メニューと伝播の抑止)', () => {
    const { result } = renderHook(() => useContextMenu())
    const event = makeMouseEvent()
    act(() => {
      result.current.openMenu(event, null)
    })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })

  it('node に null を渡せる(ツリー空白領域)', () => {
    const { result } = renderHook(() => useContextMenu())
    act(() => {
      result.current.openMenu(makeMouseEvent(), null)
    })
    expect(result.current.menu?.node).toBeNull()
  })

  it('closeMenu で menu が null に戻る', () => {
    const { result } = renderHook(() => useContextMenu())
    act(() => {
      result.current.openMenu(makeMouseEvent(), fileNode)
    })
    act(() => {
      result.current.closeMenu()
    })
    expect(result.current.menu).toBeNull()
  })
})
