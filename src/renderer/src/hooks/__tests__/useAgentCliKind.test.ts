import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import { useAgentCliKind } from '../useAgentCliKind'

const mockGet = vi.mocked(settingsApi.getAgentCliKind)
const mockSet = vi.mocked(settingsApi.setAgentCliKind)
let consoleErrorSpy: MockInstance<typeof console.error> | null = null

const SAVE_ERROR =
  '使うエージェント CLI を保存できませんでした: 設定ファイルを読み書きできませんでした。ほかのアプリで settings.json を開いていれば閉じてから、もう一度試してください。続くときは settings.json が壊れていないか確かめてください'

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
})

describe('useAgentCliKind', () => {
  it('読み込みが終わるまでは null、終わったら保存された種類と既定に戻した理由', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: 'invalid-value' })
    const { result } = renderHook(() => useAgentCliKind())
    expect(result.current.kind).toBeNull()
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    expect(result.current.fallback).toBe('invalid-value')
  })

  it('読み込みの IPC が拒否されたら claude と read-failed にし、記録する(画面を止めない)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockRejectedValueOnce(new Error('ipc'))
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    expect(result.current.fallback).toBe('read-failed')
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('選んだらすぐ保存して表示を切り替え、既定に戻した旨を消す', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: 'invalid-value' })
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await expect(result.current.changeKind('copilot')).resolves.toBe(true)
    })
    expect(mockSet).toHaveBeenCalledExactlyOnceWith('copilot')
    expect(result.current).toMatchObject({ kind: 'copilot', fallback: null, saveError: null })
  })

  it('不正な値(invalid-value)のときに同じ種類を選び直しても保存し、既定に戻した旨を消す', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: 'invalid-value' })
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await expect(result.current.changeKind('claude')).resolves.toBe(true)
    })
    expect(mockSet).toHaveBeenCalledExactlyOnceWith('claude')
    expect(result.current).toMatchObject({ kind: 'claude', fallback: null, saveError: null })
  })

  it('保存に失敗したら保存の前の値に戻し、false を返して理由を出す(既定に戻した旨は残す。L-001)', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: 'read-failed' })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockSet.mockRejectedValueOnce(new Error('disk full'))
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await expect(result.current.changeKind('copilot')).resolves.toBe(false)
    })
    expect(result.current).toMatchObject({
      kind: 'claude',
      fallback: 'read-failed',
      saveError: SAVE_ERROR
    })
  })

  it('保存に続けて失敗しても、2 回目も保存の前の値(読み込んだ値)に戻す(失敗した値を次の戻し先にしない)', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: null })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockSet.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x'))
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await result.current.changeKind('copilot')
    })
    await act(async () => {
      await expect(result.current.changeKind('copilot')).resolves.toBe(false)
    })
    expect(result.current.kind).toBe('claude')
  })

  it('保存の失敗の文言に例外の文言を入れず、例外は記録だけする(壊れた settings.json の中身の断片を出さない。L-017)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: null })
    // settings.json が壊れていると、main の JSON.parse の SyntaxError(ファイルの中身の断片を含む)が IPC の拒否の文言に入る
    const err = new Error(
      `Error invoking remote method 'settings:setAgentCliKind': SyntaxError: Unexpected token 'x', "{"encryptedApiKey":"SECRET-CIPHER"x" is not valid JSON`
    )
    mockSet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await result.current.changeKind('copilot')
    })
    expect(result.current.saveError).toBe(SAVE_ERROR)
    expect(result.current.saveError).not.toContain('SECRET-CIPHER')
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), err)
  })

  it('次の保存で失敗の文言を消す', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: null })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockSet.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await result.current.changeKind('copilot')
    })
    await act(async () => {
      await result.current.changeKind('copilot')
    })
    expect(result.current).toMatchObject({ kind: 'copilot', saveError: null })
  })
})
