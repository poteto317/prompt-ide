import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

vi.mock('../../lib/claudeApi')

import * as claudeApi from '../../lib/claudeApi'
import { useApiKeySettings } from '../useApiKeySettings'

const mockHasApiKey = vi.mocked(claudeApi.hasApiKey)
const mockSetApiKey = vi.mocked(claudeApi.setApiKey)

const API_KEY_LOAD_ERROR =
  'API キーを読み込めませんでした: システムのキーストアまたは設定ファイルを使えませんでした。保存済みのキーを復号できなかったときはキーを消してあるため、アプリを再起動すると再設定できます。再起動しても続くときは、システムのキーストア（キーチェーンなど）が使えるか、アプリのデータフォルダの settings.json が壊れていないかを確かめてください'

let consoleSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  consoleSpy = null
  vi.clearAllMocks()
  mockHasApiKey.mockResolvedValue(false)
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
    mockHasApiKey.mockResolvedValue(true)
    const { result } = renderHook(() => useApiKeySettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.hasKey).toBe(true)
    expect(mockHasApiKey).toHaveBeenCalledOnce()
  })

  it('hasApiKey が false を返したとき hasKey=false で apiKeyLoaded=true になる', async () => {
    mockHasApiKey.mockResolvedValue(false)
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

  it('hasApiKey が reject したとき、keyStoreError に例外の文言ではなく固定の文言がセットされる(L-017)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // main の設定ファイルの読み込みの例外(JSON.parse の SyntaxError)には settings.json の中身の断片が入りうる
    mockHasApiKey.mockRejectedValue(
      new Error(
        'Error invoking remote method \'settings:hasApiKey\': SyntaxError: Unexpected token \'x\', "{"encryptedApiKey":"SECRET-CIPHER"x" is not valid JSON'
      )
    )
    const { result } = renderHook(() => useApiKeySettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.keyStoreError).toBe(API_KEY_LOAD_ERROR)
    expect(result.current.keyStoreError).not.toContain('SECRET-CIPHER')
  })

  it('hasApiKey が reject したとき Error でない場合も同じ固定の文言がセットされる', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockHasApiKey.mockRejectedValue('string error')
    const { result } = renderHook(() => useApiKeySettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.keyStoreError).toBe(API_KEY_LOAD_ERROR)
  })

  it('hasApiKey が成功したとき keyStoreError は null のまま', async () => {
    mockHasApiKey.mockResolvedValue(true)
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
