import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useApiKeyForm } from '../useApiKeyForm'

const makeOptions = (overrides?: Partial<{ onSave: (key: string) => Promise<void> }>) => ({
  apiKeyLoaded: true,
  keyStoreError: null as string | null,
  onSave: vi.fn().mockResolvedValue(undefined) as (key: string) => Promise<void>,
  ...overrides,
})

let defaultOptions: ReturnType<typeof makeOptions>

beforeEach(() => {
  vi.clearAllMocks()
  defaultOptions = makeOptions()
})

describe('useApiKeyForm', () => {
  describe('初期状態', () => {
    it('inputValue が空文字で初期化される', () => {
      const { result } = renderHook(() => useApiKeyForm(defaultOptions))
      expect(result.current.inputValue).toBe('')
    })

    it('isSaving が false で初期化される', () => {
      const { result } = renderHook(() => useApiKeyForm(defaultOptions))
      expect(result.current.isSaving).toBe(false)
    })

    it('saved が false で初期化される', () => {
      const { result } = renderHook(() => useApiKeyForm(defaultOptions))
      expect(result.current.saved).toBe(false)
    })

    it('saveError が null で初期化される', () => {
      const { result } = renderHook(() => useApiKeyForm(defaultOptions))
      expect(result.current.saveError).toBeNull()
    })
  })

  describe('isSaveDisabled', () => {
    it('inputValue が空のとき true', () => {
      const { result } = renderHook(() => useApiKeyForm(defaultOptions))
      expect(result.current.isSaveDisabled).toBe(true)
    })

    it('inputValue がスペースのみのとき true', () => {
      const { result } = renderHook(() => useApiKeyForm(defaultOptions))
      act(() => result.current.setInputValue('   '))
      expect(result.current.isSaveDisabled).toBe(true)
    })

    it('apiKeyLoaded=false のとき true', () => {
      const { result } = renderHook(() =>
        useApiKeyForm({ ...defaultOptions, apiKeyLoaded: false })
      )
      act(() => result.current.setInputValue('sk-ant-test'))
      expect(result.current.isSaveDisabled).toBe(true)
    })

    it('keyStoreError があるとき true', () => {
      const { result } = renderHook(() =>
        useApiKeyForm({ ...defaultOptions, keyStoreError: 'エラー' })
      )
      act(() => result.current.setInputValue('sk-ant-test'))
      expect(result.current.isSaveDisabled).toBe(true)
    })

    it('inputValue があり apiKeyLoaded=true かつ keyStoreError=null のとき false', () => {
      const { result } = renderHook(() => useApiKeyForm(defaultOptions))
      act(() => result.current.setInputValue('sk-ant-test'))
      expect(result.current.isSaveDisabled).toBe(false)
    })
  })

  describe('handleSave — 成功', () => {
    it('onSave が trim 済み値で呼ばれる', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() => useApiKeyForm({ ...defaultOptions, onSave }))
      act(() => result.current.setInputValue('  sk-ant-test  '))
      await act(() => result.current.handleSave())
      expect(onSave).toHaveBeenCalledWith('sk-ant-test')
    })

    it('保存成功後に saved が true になる', async () => {
      const { result } = renderHook(() => useApiKeyForm(defaultOptions))
      act(() => result.current.setInputValue('sk-ant-test'))
      await act(() => result.current.handleSave())
      expect(result.current.saved).toBe(true)
    })

    it('保存成功後に inputValue がクリアされる', async () => {
      const { result } = renderHook(() => useApiKeyForm(defaultOptions))
      act(() => result.current.setInputValue('sk-ant-test'))
      await act(() => result.current.handleSave())
      expect(result.current.inputValue).toBe('')
    })

    it('保存完了後に isSaving が false に戻る', async () => {
      const { result } = renderHook(() => useApiKeyForm(defaultOptions))
      act(() => result.current.setInputValue('sk-ant-test'))
      await act(() => result.current.handleSave())
      expect(result.current.isSaving).toBe(false)
    })

    it('保存成功後に saveError が null のまま', async () => {
      const { result } = renderHook(() => useApiKeyForm(defaultOptions))
      act(() => result.current.setInputValue('sk-ant-test'))
      await act(() => result.current.handleSave())
      expect(result.current.saveError).toBeNull()
    })
  })

  describe('handleSave — 失敗', () => {
    it('onSave が reject したとき saveError にメッセージが入る', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('キーストアが利用できません'))
      const { result } = renderHook(() => useApiKeyForm({ ...defaultOptions, onSave }))
      act(() => result.current.setInputValue('sk-ant-test'))
      await act(() => result.current.handleSave())
      expect(result.current.saveError).toBe('キーストアが利用できません')
    })

    it('保存失敗時は saved が false のまま', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('失敗'))
      const { result } = renderHook(() => useApiKeyForm({ ...defaultOptions, onSave }))
      act(() => result.current.setInputValue('sk-ant-test'))
      await act(() => result.current.handleSave())
      expect(result.current.saved).toBe(false)
    })

    it('保存失敗後に isSaving が false に戻る', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('失敗'))
      const { result } = renderHook(() => useApiKeyForm({ ...defaultOptions, onSave }))
      act(() => result.current.setInputValue('sk-ant-test'))
      await act(() => result.current.handleSave())
      expect(result.current.isSaving).toBe(false)
    })

    it('Error でない reject のとき「保存に失敗しました」が saveError に入る', async () => {
      const onSave = vi.fn().mockRejectedValue('string error')
      const { result } = renderHook(() => useApiKeyForm({ ...defaultOptions, onSave }))
      act(() => result.current.setInputValue('sk-ant-test'))
      await act(() => result.current.handleSave())
      expect(result.current.saveError).toBe('保存に失敗しました')
    })
  })

  describe('handleSave — ガード（早期 return）', () => {
    it('inputValue が空のとき onSave が呼ばれない', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() => useApiKeyForm({ ...defaultOptions, onSave }))
      // inputValue は '' のまま
      await act(() => result.current.handleSave())
      expect(onSave).not.toHaveBeenCalled()
    })

    it('inputValue がスペースのみのとき onSave が呼ばれない', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() => useApiKeyForm({ ...defaultOptions, onSave }))
      act(() => result.current.setInputValue('   '))
      await act(() => result.current.handleSave())
      expect(onSave).not.toHaveBeenCalled()
    })

    it('apiKeyLoaded=false のとき onSave が呼ばれない', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() =>
        useApiKeyForm({ ...defaultOptions, apiKeyLoaded: false, onSave })
      )
      act(() => result.current.setInputValue('sk-ant-test'))
      await act(() => result.current.handleSave())
      expect(onSave).not.toHaveBeenCalled()
    })

    it('keyStoreError があるとき onSave が呼ばれない', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() =>
        useApiKeyForm({ ...defaultOptions, keyStoreError: 'エラー', onSave })
      )
      act(() => result.current.setInputValue('sk-ant-test'))
      await act(() => result.current.handleSave())
      expect(onSave).not.toHaveBeenCalled()
    })

    it('ガード時は isSaving が変化しない', async () => {
      const { result } = renderHook(() => useApiKeyForm(defaultOptions))
      // inputValue が空 → ガード
      await act(() => result.current.handleSave())
      expect(result.current.isSaving).toBe(false)
    })
  })

  describe('クリーンアップ', () => {
    it('アンマウント後にタイマーがクリアされる（メモリリークなし）', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
      const { result, unmount } = renderHook(() => useApiKeyForm(defaultOptions))
      act(() => result.current.setInputValue('sk-ant-test'))
      await act(() => result.current.handleSave())
      // saved=true の状態でアンマウント → タイマーがクリアされる
      unmount()
      await waitFor(() => expect(clearTimeoutSpy).toHaveBeenCalled())
      clearTimeoutSpy.mockRestore()
    })
  })
})
