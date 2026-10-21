import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

vi.mock('../../lib/claudeApi')

import * as claudeApi from '../../lib/claudeApi'
import { useApiKeySettings } from '../useApiKeySettings'

const mockHasApiKey = vi.mocked(claudeApi.hasApiKey)
const mockSetApiKey = vi.mocked(claudeApi.setApiKey)

// 文言は定数を通さずに書き、定数の文言が変わったらテストで気づけるようにする
const SETTINGS_FILE_REASON =
  '設定ファイルを読み書きできませんでした。ほかのアプリで settings.json を開いていれば閉じてから、もう一度試してください。続くときはアプリのデータフォルダの settings.json が壊れていないか確かめてください'
const LOAD_ERRORS = {
  'decrypt-failed':
    'API キーを読み込めませんでした: 保存済みのキーを復号できませんでした。キーを消してあるため、アプリを再起動すると再設定できます',
  'keystore-unavailable':
    'API キーを読み込めませんでした: システムのキーストアを使えませんでした。システムのキーストア（キーチェーンなど）が使えるかを確かめてください',
  'settings-file-error': `API キーを読み込めませんでした: ${SETTINGS_FILE_REASON}`,
  unknown:
    'API キーを読み込めませんでした: システムのキーストアまたは設定ファイルを使えませんでした。システムのキーストア（キーチェーンなど）が使えるか、アプリのデータフォルダの settings.json が壊れていないかを確かめてください'
} as const

let consoleSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  consoleSpy = null
  vi.clearAllMocks()
  mockHasApiKey.mockResolvedValue({ ok: true, hasKey: false })
  mockSetApiKey.mockResolvedValue(undefined)
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('useApiKeySettings', () => {
  it('初期状態: hasKey=false, apiKeyLoaded=false, keyStoreError=null', () => {
    const { result } = renderHook(() => useApiKeySettings())
    expect(result.current.hasKey).toBe(false)
    expect(result.current.apiKeyLoaded).toBe(false)
    expect(result.current.keyStoreError).toBeNull()
  })

  it('mount 時に hasApiKey が呼ばれ hasKey と apiKeyLoaded がセットされる（キーあり）', async () => {
    mockHasApiKey.mockResolvedValue({ ok: true, hasKey: true })
    const { result } = renderHook(() => useApiKeySettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.hasKey).toBe(true)
    expect(mockHasApiKey).toHaveBeenCalledOnce()
  })

  it('hasApiKey がキー無しを返したとき hasKey=false で apiKeyLoaded=true になる', async () => {
    mockHasApiKey.mockResolvedValue({ ok: true, hasKey: false })
    const { result } = renderHook(() => useApiKeySettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.hasKey).toBe(false)
  })

  it('hasApiKey が reject したとき apiKeyLoaded=true になり hasKey=false のまま', async () => {
    mockHasApiKey.mockRejectedValue(new Error('keystore unavailable'))
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useApiKeySettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.hasKey).toBe(false)
  })

  it.each([
    ['decrypt-failed', LOAD_ERRORS['decrypt-failed']],
    ['keystore-unavailable', LOAD_ERRORS['keystore-unavailable']],
    ['settings-file-error', LOAD_ERRORS['settings-file-error']],
    ['unknown', LOAD_ERRORS.unknown]
  ] as const)(
    '読み込みの失敗の理由が %s のとき、その種類の固定の文言がセットされ、hasKey=false のまま',
    async (reason, message) => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockHasApiKey.mockResolvedValue({ ok: false, reason })
      const { result } = renderHook(() => useApiKeySettings())
      await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
      expect(result.current.keyStoreError).toBe(message)
      expect(result.current.hasKey).toBe(false)
    }
  )

  it('読み込みの失敗の理由を console.error に記録する', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockHasApiKey.mockResolvedValue({ ok: false, reason: 'decrypt-failed' })
    const { result } = renderHook(() => useApiKeySettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(consoleSpy).toHaveBeenCalledOnce()
    expect(consoleSpy?.mock.calls[0]).toContain('decrypt-failed')
  })

  it('hasApiKey が reject したとき、keyStoreError に例外の文言ではなく unknown の固定の文言がセットされる(L-017)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // IPC そのものの失敗の例外には、main の例外の文言(パスや settings.json の中身の断片)が入りうる
    mockHasApiKey.mockRejectedValue(
      new Error(
        'Error invoking remote method \'settings:hasApiKey\': SyntaxError: Unexpected token \'x\', "{"encryptedApiKey":"SECRET-CIPHER"x" is not valid JSON'
      )
    )
    const { result } = renderHook(() => useApiKeySettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.keyStoreError).toBe(LOAD_ERRORS.unknown)
    expect(result.current.keyStoreError).not.toContain('SECRET-CIPHER')
  })

  it('hasApiKey が reject したとき Error でない場合も unknown の固定の文言がセットされる', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockHasApiKey.mockRejectedValue('string error')
    const { result } = renderHook(() => useApiKeySettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.keyStoreError).toBe(LOAD_ERRORS.unknown)
  })

  it('hasApiKey が成功したとき keyStoreError は null のまま', async () => {
    mockHasApiKey.mockResolvedValue({ ok: true, hasKey: true })
    const { result } = renderHook(() => useApiKeySettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.keyStoreError).toBeNull()
  })

  it('hasApiKey が reject したとき console.error が呼ばれる', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockHasApiKey.mockRejectedValue(new Error('keystore error'))
    const { result } = renderHook(() => useApiKeySettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(consoleSpy).toHaveBeenCalledOnce()
  })

  it('saveApiKey を呼ぶと setApiKey IPC が呼ばれ hasKey が true になる', async () => {
    const { result } = renderHook(() => useApiKeySettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))

    await act(async () => {
      await result.current.saveApiKey('sk-ant-new')
    })
    expect(mockSetApiKey).toHaveBeenCalledWith('sk-ant-new')
    expect(result.current.hasKey).toBe(true)
  })
})
