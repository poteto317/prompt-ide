import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useStageRecordForm } from '../useStageRecordForm'

describe('useStageRecordForm', () => {
  describe('初期状態', () => {
    it('note が空文字で初期化される', () => {
      const { result } = renderHook(() => useStageRecordForm(vi.fn()))
      expect(result.current.note).toBe('')
    })
  })

  describe('note 入力', () => {
    it('setNote で note が更新される', () => {
      const { result } = renderHook(() => useStageRecordForm(vi.fn()))
      act(() => result.current.setNote('メモ'))
      expect(result.current.note).toBe('メモ')
    })
  })

  describe('handleRecord', () => {
    it('trim した note で onRecord が呼ばれる', () => {
      const onRecord = vi.fn()
      const { result } = renderHook(() => useStageRecordForm(onRecord))
      act(() => result.current.setNote('  メモ内容  '))
      act(() => result.current.handleRecord())
      expect(onRecord).toHaveBeenCalledWith('メモ内容')
    })

    it('空文字のとき undefined で onRecord が呼ばれる', () => {
      const onRecord = vi.fn()
      const { result } = renderHook(() => useStageRecordForm(onRecord))
      act(() => result.current.handleRecord())
      expect(onRecord).toHaveBeenCalledWith(undefined)
    })

    it('空白のみのメモは trim され undefined で onRecord が呼ばれる', () => {
      const onRecord = vi.fn()
      const { result } = renderHook(() => useStageRecordForm(onRecord))
      act(() => result.current.setNote('   '))
      act(() => result.current.handleRecord())
      expect(onRecord).toHaveBeenCalledWith(undefined)
    })

    it('記録後に note がリセットされる', () => {
      const { result } = renderHook(() => useStageRecordForm(vi.fn()))
      act(() => result.current.setNote('メモ'))
      act(() => result.current.handleRecord())
      expect(result.current.note).toBe('')
    })

    it('前後の空白のみが除去される（中間の空白は保持）', () => {
      const onRecord = vi.fn()
      const { result } = renderHook(() => useStageRecordForm(onRecord))
      act(() => result.current.setNote(' メモ A メモ B '))
      act(() => result.current.handleRecord())
      expect(onRecord).toHaveBeenCalledWith('メモ A メモ B')
    })
  })
})
