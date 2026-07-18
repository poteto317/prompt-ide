import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useModelSettingsForm } from '../useModelSettingsForm'
import type { ModelSettings } from '@shared/types'

const makeOptions = (
  overrides?: Partial<{ onSave: (settings: ModelSettings) => Promise<void> }>
) => ({
  onSave: vi.fn().mockResolvedValue(undefined) as (settings: ModelSettings) => Promise<void>,
  ...overrides
})

let defaultOptions: ReturnType<typeof makeOptions>

beforeEach(() => {
  vi.clearAllMocks()
  defaultOptions = makeOptions()
})

describe('useModelSettingsForm', () => {
  describe('初期状態', () => {
    it('isSaving が false で初期化される', () => {
      const { result } = renderHook(() => useModelSettingsForm(defaultOptions))
      expect(result.current.isSaving).toBe(false)
    })

    it('saved が false で初期化される', () => {
      const { result } = renderHook(() => useModelSettingsForm(defaultOptions))
      expect(result.current.saved).toBe(false)
    })

    it('saveError が null で初期化される', () => {
      const { result } = renderHook(() => useModelSettingsForm(defaultOptions))
      expect(result.current.saveError).toBeNull()
    })
  })

  describe('handleSave — 成功', () => {
    it('onSave が渡した設定で呼ばれる', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() => useModelSettingsForm({ ...defaultOptions, onSave }))
      const settings: ModelSettings = { modelId: 'claude-opus-4-8', maxTokens: 8000 }
      await act(() => result.current.handleSave(settings))
      expect(onSave).toHaveBeenCalledWith(settings)
    })

    it('保存成功後に saved が true になる', async () => {
      const { result } = renderHook(() => useModelSettingsForm(defaultOptions))
      await act(() => result.current.handleSave({ modelId: 'claude-haiku-4-5', maxTokens: 4096 }))
      expect(result.current.saved).toBe(true)
    })

    it('保存完了後に isSaving が false に戻る', async () => {
      const { result } = renderHook(() => useModelSettingsForm(defaultOptions))
      await act(() => result.current.handleSave({ modelId: 'claude-haiku-4-5', maxTokens: 4096 }))
      expect(result.current.isSaving).toBe(false)
    })
  })

  describe('handleSave — 失敗', () => {
    it('onSave が reject したとき saveError にメッセージが入る', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('保存に失敗しました'))
      const { result } = renderHook(() => useModelSettingsForm({ ...defaultOptions, onSave }))
      await act(() => result.current.handleSave({ modelId: 'claude-haiku-4-5', maxTokens: 4096 }))
      expect(result.current.saveError).toBe('保存に失敗しました')
    })

    it('保存失敗時は saved が false のまま', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('失敗'))
      const { result } = renderHook(() => useModelSettingsForm({ ...defaultOptions, onSave }))
      await act(() => result.current.handleSave({ modelId: 'claude-haiku-4-5', maxTokens: 4096 }))
      expect(result.current.saved).toBe(false)
    })

    it('Error でない reject のとき「保存に失敗しました」が saveError に入る', async () => {
      const onSave = vi.fn().mockRejectedValue('string error')
      const { result } = renderHook(() => useModelSettingsForm({ ...defaultOptions, onSave }))
      await act(() => result.current.handleSave({ modelId: 'claude-haiku-4-5', maxTokens: 4096 }))
      expect(result.current.saveError).toBe('保存に失敗しました')
    })
  })

  describe('クリーンアップ', () => {
    it('アンマウント後にタイマーがクリアされる（メモリリークなし）', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
      const { result, unmount } = renderHook(() => useModelSettingsForm(defaultOptions))
      await act(() => result.current.handleSave({ modelId: 'claude-haiku-4-5', maxTokens: 4096 }))
      unmount()
      await waitFor(() => expect(clearTimeoutSpy).toHaveBeenCalled())
      clearTimeoutSpy.mockRestore()
    })
  })
})
