import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type { AgentLastSession } from '@shared/types'

vi.mock('../../lib/agentTerminalApi')

import * as agentTerminalApi from '../../lib/agentTerminalApi'
import { useAgentLastSession } from '../useAgentLastSession'
import type { UseAgentLastSessionOptions } from '../useAgentLastSession'

const mockGetLast = vi.mocked(agentTerminalApi.getLastAgentSession)
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-9222-222222222222'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let consoleErrorSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.resetAllMocks()
  consoleErrorSpy = null
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
})

const renderLast = (
  initial: UseAgentLastSessionOptions
): ReturnType<
  typeof renderHook<ReturnType<typeof useAgentLastSession>, UseAgentLastSessionOptions>
> =>
  renderHook((props: UseAgentLastSessionOptions) => useAgentLastSession(props), {
    initialProps: initial
  })

describe('useAgentLastSession', () => {
  it('無効(従来の方式)・フォルダ無しは取りに行かず、記録なし', () => {
    expect(
      renderLast({ folderPath: '/w', enabled: false, cliKind: 'claude', refreshKey: '' }).result
        .current
    ).toEqual({
      kind: 'none'
    })
    expect(
      renderLast({ folderPath: null, enabled: true, cliKind: 'claude', refreshKey: '' }).result
        .current
    ).toEqual({
      kind: 'none'
    })
    expect(mockGetLast).not.toHaveBeenCalled()
  })

  it('取得中の後、記録の先頭を返す。記録が無ければ none', async () => {
    mockGetLast.mockResolvedValueOnce({ cliKind: 'claude', claudeSessionId: A })
    const { result } = renderLast({
      folderPath: '/w',
      enabled: true,
      cliKind: 'claude',
      refreshKey: ''
    })
    expect(result.current).toEqual({ kind: 'loading' })
    expect(mockGetLast).toHaveBeenCalledExactlyOnceWith('/w', 'claude')
    await waitFor(() =>
      expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: A })
    )
    mockGetLast.mockResolvedValueOnce(null)
    const other = renderLast({ folderPath: '/x', enabled: true, cliKind: 'claude', refreshKey: '' })
    await waitFor(() => expect(other.result.current).toEqual({ kind: 'none' }))
  })

  it('取得の失敗は記録なしとして扱い、ログに残す', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGetLast.mockRejectedValueOnce(new Error('ipc down'))
    const { result } = renderLast({
      folderPath: '/w',
      enabled: true,
      cliKind: 'claude',
      refreshKey: ''
    })
    await waitFor(() => expect(result.current).toEqual({ kind: 'none' }))
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('フォルダが変わったら取得中に戻して取り直し、依頼の後にフォルダが変わった結果は捨てる(L-037)', async () => {
    const first = deferred<AgentLastSession | null>()
    const second = deferred<AgentLastSession | null>()
    mockGetLast.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result, rerender } = renderLast({
      folderPath: '/w',
      enabled: true,
      cliKind: 'claude',
      refreshKey: ''
    })
    rerender({ folderPath: '/x', enabled: true, cliKind: 'claude', refreshKey: '' })
    expect(mockGetLast).toHaveBeenLastCalledWith('/x', 'claude')
    await act(async () => {
      first.resolve({ cliKind: 'claude', claudeSessionId: A })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ kind: 'loading' })
    await act(async () => {
      second.resolve({ cliKind: 'claude', claudeSessionId: B })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: B })
  })

  it('ほかのフォルダから戻ったときは、前に取った結果を出さず取り直す', async () => {
    mockGetLast.mockResolvedValueOnce({ cliKind: 'claude', claudeSessionId: A })
    const { result, rerender } = renderLast({
      folderPath: '/w',
      enabled: true,
      cliKind: 'claude',
      refreshKey: ''
    })
    await waitFor(() =>
      expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: A })
    )
    const back = deferred<AgentLastSession | null>()
    mockGetLast.mockReturnValueOnce(new Promise(() => undefined)).mockReturnValueOnce(back.promise)
    rerender({ folderPath: '/x', enabled: true, cliKind: 'claude', refreshKey: '' })
    rerender({ folderPath: '/w', enabled: true, cliKind: 'claude', refreshKey: '' })
    expect(result.current).toEqual({ kind: 'loading' })
    await act(async () => {
      back.resolve({ cliKind: 'claude', claudeSessionId: B })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: B })
  })

  it('取り直しの契機(起動の成功)で取り直し、取り直す間は前の結果を出し続ける。古い依頼の結果は捨てる(L-040)', async () => {
    mockGetLast.mockResolvedValueOnce({ cliKind: 'claude', claudeSessionId: A })
    const { result, rerender } = renderLast({
      folderPath: '/w',
      enabled: true,
      cliKind: 'claude',
      refreshKey: ''
    })
    await waitFor(() =>
      expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: A })
    )
    const older = deferred<AgentLastSession | null>()
    const newer = deferred<AgentLastSession | null>()
    mockGetLast.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    rerender({ folderPath: '/w', enabled: true, cliKind: 'claude', refreshKey: A })
    rerender({ folderPath: '/w', enabled: true, cliKind: 'claude', refreshKey: `${A},${B}` })
    expect(mockGetLast).toHaveBeenCalledTimes(3)
    expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: A })
    await act(async () => {
      newer.resolve({ cliKind: 'claude', claudeSessionId: B })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: B })
    await act(async () => {
      older.resolve({ cliKind: 'claude', claudeSessionId: A })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: B })
  })

  it('取りに行く種類(設定の種類)を依頼に載せ、種類が変わったら取り直す', async () => {
    mockGetLast.mockResolvedValueOnce({ cliKind: 'claude', claudeSessionId: A })
    const { result, rerender } = renderLast({
      folderPath: '/w',
      cliKind: 'claude',
      enabled: true,
      refreshKey: ''
    })
    await waitFor(() =>
      expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: A })
    )
    mockGetLast.mockResolvedValueOnce({ cliKind: 'copilot', claudeSessionId: B })
    rerender({ folderPath: '/w', cliKind: 'copilot', enabled: true, refreshKey: '' })
    expect(mockGetLast).toHaveBeenLastCalledWith('/w', 'copilot')
    await waitFor(() =>
      expect(result.current).toEqual({ kind: 'found', cliKind: 'copilot', claudeSessionId: B })
    )
  })

  it('種類が変わったら、新しい種類の結果が届くまで取得中に戻し、前の種類の結果を出さない(L-037)', async () => {
    mockGetLast.mockResolvedValueOnce({ cliKind: 'claude', claudeSessionId: A })
    const { result, rerender } = renderLast({
      folderPath: '/w',
      cliKind: 'claude',
      enabled: true,
      refreshKey: ''
    })
    await waitFor(() =>
      expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: A })
    )
    const pending = deferred<AgentLastSession | null>()
    mockGetLast.mockReturnValueOnce(pending.promise)
    rerender({ folderPath: '/w', cliKind: 'copilot', enabled: true, refreshKey: '' })
    expect(result.current).toEqual({ kind: 'loading' })
    await act(async () => {
      pending.resolve({ cliKind: 'copilot', claudeSessionId: B })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ kind: 'found', cliKind: 'copilot', claudeSessionId: B })
  })

  it('種類を戻したときは、前に取った結果を出さず取り直す', async () => {
    mockGetLast.mockResolvedValueOnce({ cliKind: 'claude', claudeSessionId: A })
    const { result, rerender } = renderLast({
      folderPath: '/w',
      cliKind: 'claude',
      enabled: true,
      refreshKey: ''
    })
    await waitFor(() =>
      expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: A })
    )
    const back = deferred<AgentLastSession | null>()
    mockGetLast.mockReturnValueOnce(new Promise(() => undefined)).mockReturnValueOnce(back.promise)
    rerender({ folderPath: '/w', cliKind: 'copilot', enabled: true, refreshKey: '' })
    rerender({ folderPath: '/w', cliKind: 'claude', enabled: true, refreshKey: '' })
    expect(result.current).toEqual({ kind: 'loading' })
    await act(async () => {
      back.resolve({ cliKind: 'claude', claudeSessionId: B })
      await Promise.resolve()
    })
    expect(result.current).toEqual({ kind: 'found', cliKind: 'claude', claudeSessionId: B })
  })

  it('依頼と違う種類の結果は記録なしとして扱い、ログに残す(起きない想定)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGetLast.mockResolvedValueOnce({ cliKind: 'claude', claudeSessionId: A })
    const { result } = renderLast({
      folderPath: '/w',
      cliKind: 'copilot',
      enabled: true,
      refreshKey: ''
    })
    await waitFor(() => expect(result.current).toEqual({ kind: 'none' }))
    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})
