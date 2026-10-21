import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { useModelSettingsForm } from '../useModelSettingsForm'
import type { ModelSettings } from '@shared/types'

interface Options {
  onSave: (settings: ModelSettings) => Promise<void>
}

const makeOptions = (overrides?: Partial<Options>): Options => ({
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
    let consoleSpy: MockInstance<typeof console.error>

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('onSave が reject したとき、例外の文言ではなく固定の文言を出し、例外は記録だけする(L-017)', async () => {
      // main の設定ファイルの読み書きの例外には settings.json のパスや中身の断片が入りうる
      const err = new Error(
        'Error invoking remote method \'settings:setModelSettings\': SyntaxError: Unexpected token \'x\', "{"encryptedApiKey":"SECRET-CIPHER"x" is not valid JSON'
      )
      const onSave = vi.fn().mockRejectedValue(err)
      const { result } = renderHook(() => useModelSettingsForm({ ...defaultOptions, onSave }))
      await act(() => result.current.handleSave({ modelId: 'claude-haiku-4-5', maxTokens: 4096 }))
      expect(result.current.saveError).toBe(
        'モデルの設定を保存できませんでした: 設定ファイルを読み書きできませんでした'
      )
      expect(result.current.saveError).not.toContain('SECRET-CIPHER')
      expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), err)
    })

    it('保存失敗時は saved が false のまま', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('失敗'))
      const { result } = renderHook(() => useModelSettingsForm({ ...defaultOptions, onSave }))
      await act(() => result.current.handleSave({ modelId: 'claude-haiku-4-5', maxTokens: 4096 }))
      expect(result.current.saved).toBe(false)
    })

    it('Error でない reject のときも同じ固定の文言が saveError に入る', async () => {
      const onSave = vi.fn().mockRejectedValue('string error')
      const { result } = renderHook(() => useModelSettingsForm({ ...defaultOptions, onSave }))
      await act(() => result.current.handleSave({ modelId: 'claude-haiku-4-5', maxTokens: 4096 }))
      expect(result.current.saveError).toBe(
        'モデルの設定を保存できませんでした: 設定ファイルを読み書きできませんでした'
      )
    })
  })

  describe('多重実行防止', () => {
    it('保存処理中に再度 handleSave を呼んでも onSave は1回しか呼ばれない(連打防止)', async () => {
      // isSaving state のコミット前(同一同期実行内)に2回呼ばれても、
      // ref による即時反映のガードで2回目は無視されることを検証する
      let resolveOnSave: () => void = () => {}
      const onSave = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveOnSave = resolve
          })
      )
      const { result } = renderHook(() => useModelSettingsForm({ ...defaultOptions, onSave }))
      const settings: ModelSettings = { modelId: 'claude-haiku-4-5', maxTokens: 4096 }

      let firstCall!: Promise<void>
      let secondCall!: Promise<void>
      act(() => {
        firstCall = result.current.handleSave(settings)
        secondCall = result.current.handleSave(settings)
      })

      expect(onSave).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveOnSave()
        await firstCall
        await secondCall
      })
    })

    it('保存完了後は再度 handleSave を呼べる', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() => useModelSettingsForm({ ...defaultOptions, onSave }))
      const settings: ModelSettings = { modelId: 'claude-haiku-4-5', maxTokens: 4096 }

      await act(() => result.current.handleSave(settings))
      await act(() => result.current.handleSave(settings))

      expect(onSave).toHaveBeenCalledTimes(2)
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
