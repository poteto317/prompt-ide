import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { AgentChangesListResult, AgentChangesState } from '@shared/types'
import { useAgentChanges } from '../useAgentChanges'
import { toAnnouncementText } from '../../lib/announcementText'
import { AGENT_CHANGES_CLEARED_NOTICE } from '../../lib/agentChangesMessages'
import {
  makeAgentChangeEntry,
  makeAgentChangesListResult
} from '../../__tests__/makeAgentChangesState'

const recordingState: AgentChangesState = { kind: 'recording', startedAt: 100 }
// 一覧の件数・パスを試すことが多いため、パスだけで変更の行(status M)の一覧を作る
const listOf = (paths: string[], startedAt = 100): AgentChangesListResult =>
  makeAgentChangesListResult(
    paths.map((path) => makeAgentChangeEntry(path)),
    { startedAt }
  )

// 解決を遅らせられる Promise
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (e: unknown) => void
} {
  let resolve: (value: T) => void = () => undefined
  let reject: (e: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  window.api.getAgentChangesState = vi.fn().mockResolvedValue({ kind: 'none' })
  window.api.beginAgentChanges = vi.fn().mockResolvedValue(recordingState)
  window.api.listAgentChanges = vi.fn().mockResolvedValue(listOf(['a.txt']))
  window.api.clearAgentChanges = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAgentChanges', () => {
  it('begin で記録中になり、refresh で一覧を取る。announce なら件数を読み上げる', async () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin()
    })
    expect(result.current.view).toEqual({ kind: 'recording', startedAt: 100, list: null })
    await act(async () => {
      await result.current.refresh({ announce: true })
    })
    expect(result.current.view).toEqual({
      kind: 'recording',
      startedAt: 100,
      list: {
        entries: [{ path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false }],
        totalCount: 1,
        truncated: false,
        headChanged: false
      }
    })
    expect(toAnnouncementText(result.current.notice)).toBe('エージェントの変更: 1 件')
  })

  it('記録が無ければ refresh は一覧を取らない', async () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.refresh()
    })
    expect(window.api.listAgentChanges).not.toHaveBeenCalled()
  })

  it('記録できない結果をそのまま見せる', async () => {
    window.api.beginAgentChanges = vi
      .fn()
      .mockResolvedValue({ kind: 'unavailable', reason: 'not-toplevel' })
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin()
    })
    expect(result.current.view).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'not-toplevel' }
    })
  })

  it('begin の依頼の失敗は reject せず、git を実行できない理由にする', async () => {
    window.api.beginAgentChanges = vi.fn().mockRejectedValue(new Error('ipc'))
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin()
    })
    expect(result.current.view).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
    expect(result.current.isBeginning).toBe(false)
  })

  it('begin の途中でフォルダが変わったら、前のフォルダの結果を捨てる', async () => {
    const pending = deferred<AgentChangesState>()
    window.api.beginAgentChanges = vi.fn(() => pending.promise)
    const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
      initialProps: { folder: '/a' as string | null }
    })
    let begun: Promise<void> = Promise.resolve()
    act(() => {
      begun = result.current.begin()
    })
    rerender({ folder: '/b' })
    await act(async () => {
      pending.resolve(recordingState)
      await begun
    })
    expect(result.current.view).toEqual({ kind: 'none' })
  })

  it('古い要求の一覧は捨て、最後の要求の結果だけを反映する。読み上げは追い越した結果で行う', async () => {
    const first = deferred<AgentChangesListResult>()
    const second = deferred<AgentChangesListResult>()
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin()
    })
    window.api.listAgentChanges = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    let a: Promise<void> = Promise.resolve()
    let b: Promise<void> = Promise.resolve()
    act(() => {
      a = result.current.refresh({ announce: true })
      b = result.current.refresh()
    })
    await act(async () => {
      second.resolve(listOf(['new.txt', 'b.txt']))
      await b
      first.resolve(listOf(['old.txt']))
      await a
    })
    expect(result.current.view.kind === 'recording' && result.current.view.list?.totalCount).toBe(2)
    expect(toAnnouncementText(result.current.notice)).toBe('エージェントの変更: 2 件')
    expect(result.current.isLoading).toBe(false)
  })

  it('一覧の失敗は前回の一覧を残してエラーを出し、次の成功で消す', async () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin()
      await result.current.refresh()
    })
    window.api.listAgentChanges = vi.fn().mockRejectedValueOnce(new Error('git failed'))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.listError).toBe('git failed')
    expect(result.current.view.kind === 'recording' && result.current.view.list?.totalCount).toBe(1)
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listOf([]))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.listError).toBeNull()
  })

  it('main が記録を捨てていたら(一覧が none)記録なしにする', async () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin()
    })
    window.api.listAgentChanges = vi.fn().mockResolvedValue({ kind: 'none' })
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.view).toEqual({ kind: 'none' })
  })

  it('アプリで保存したパスは記録中だけ覚え、記録が変われば・確認を終えれば捨てる', async () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    act(() => result.current.markSaved('/repo/early.txt'))
    expect(result.current.savedPaths.size).toBe(0)
    await act(async () => {
      await result.current.begin()
    })
    act(() => result.current.markSaved('/repo/a.txt'))
    expect([...result.current.savedPaths]).toEqual(['/repo/a.txt'])
    // 同じ記録の取り直しでは残す
    await act(async () => {
      await result.current.refresh()
    })
    expect([...result.current.savedPaths]).toEqual(['/repo/a.txt'])
    await act(async () => {
      await result.current.clear()
    })
    expect(result.current.view).toEqual({ kind: 'none' })
    expect(result.current.savedPaths.size).toBe(0)
    expect(toAnnouncementText(result.current.notice)).toBe(AGENT_CHANGES_CLEARED_NOTICE)
    // 新しい記録(開始の時刻が違う)では前の記録の保存を持ち越さない
    window.api.beginAgentChanges = vi.fn().mockResolvedValue({ kind: 'recording', startedAt: 200 })
    await act(async () => {
      await result.current.begin()
    })
    expect(result.current.savedPaths.size).toBe(0)
  })

  it('フォルダが変わったら記録の写しと保存したパスを捨てる', async () => {
    const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
      initialProps: { folder: '/a' as string | null }
    })
    await act(async () => {
      await result.current.begin()
    })
    act(() => result.current.markSaved('/a/x.txt'))
    rerender({ folder: '/b' })
    expect(result.current.view).toEqual({ kind: 'none' })
    expect(result.current.savedPaths.size).toBe(0)
  })

  it('部品の作り直しの後、main に記録があれば記録中にする', async () => {
    window.api.getAgentChangesState = vi.fn().mockResolvedValue(recordingState)
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await waitFor(() =>
      expect(result.current.view).toEqual({ kind: 'recording', startedAt: 100, list: null })
    )
  })

  // マウント時の状態の照合(世代)を固定する(final-rereview の m-2)
  it('マウント時の状態の応答待ちで確認を終えたら、古い recording を反映しない', async () => {
    const pending = deferred<AgentChangesState>()
    window.api.getAgentChangesState = vi.fn().mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.clear()
    })
    await act(async () => {
      pending.resolve(recordingState)
      await pending.promise
    })
    expect(result.current.view).toEqual({ kind: 'none' })
  })

  // 世代を進める処理(フォルダの切り替え)がマウントの effect より前に走ることに依存するため、その順序を固定する
  it('フォルダを変えた後のマウント時の状態の recording は反映する', async () => {
    const { result, rerender } = renderHook(({ f }) => useAgentChanges(f), {
      initialProps: { f: '/a' }
    })
    window.api.getAgentChangesState = vi
      .fn()
      .mockResolvedValue({ kind: 'recording', startedAt: 300 })
    rerender({ f: '/b' })
    await waitFor(() =>
      expect(result.current.view).toEqual({ kind: 'recording', startedAt: 300, list: null })
    )
  })

  // 最終レビュー B の I-1(台帳 Task 12 の M1・M3・M4)
  describe('世代と読み上げの依頼', () => {
    it('読み上げを頼んだ取り直しの応答待ちでフォルダが変わったら、依頼を捨てる(次のフォルダの無言の取り直しで読み上げない)', async () => {
      const pending = deferred<AgentChangesListResult>()
      const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
        initialProps: { folder: '/a' as string | null }
      })
      await act(async () => {
        await result.current.begin()
      })
      window.api.listAgentChanges = vi.fn().mockReturnValueOnce(pending.promise)
      let refreshed: Promise<void> = Promise.resolve()
      act(() => {
        refreshed = result.current.refresh({ announce: true })
      })
      rerender({ folder: '/b' })
      await act(async () => {
        pending.resolve(listOf(['old.txt']))
        await refreshed
      })
      expect(result.current.view).toEqual({ kind: 'none' })
      expect(result.current.isLoading).toBe(false)
      window.api.beginAgentChanges = vi
        .fn()
        .mockResolvedValueOnce({ kind: 'recording', startedAt: 200 })
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce(listOf(['x.txt', 'y.txt'], 200))
      await act(async () => {
        await result.current.begin()
        await result.current.refresh()
      })
      expect(result.current.view.kind === 'recording' && result.current.view.list?.totalCount).toBe(
        2
      )
      expect(result.current.notice).toBeNull()
    })

    it('読み上げを頼んだ取り直しが失敗したら依頼を捨てる(後の無言の取り直しで読み上げない)', async () => {
      const { result } = renderHook(() => useAgentChanges('/repo'))
      await act(async () => {
        await result.current.begin()
      })
      window.api.listAgentChanges = vi.fn().mockRejectedValueOnce(new Error('git failed'))
      await act(async () => {
        await result.current.refresh({ announce: true })
      })
      expect(result.current.listError).toBe('git failed')
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce(listOf(['a.txt', 'b.txt']))
      await act(async () => {
        await result.current.refresh()
      })
      expect(result.current.listError).toBeNull()
      expect(result.current.notice).toBeNull()
    })

    it('読み上げを頼んだ取り直しの応答待ちで確認を終えたら、応答を捨て、依頼も捨てる', async () => {
      const pending = deferred<AgentChangesListResult>()
      const { result } = renderHook(() => useAgentChanges('/repo'))
      await act(async () => {
        await result.current.begin()
      })
      window.api.listAgentChanges = vi.fn().mockReturnValueOnce(pending.promise)
      let refreshed: Promise<void> = Promise.resolve()
      act(() => {
        refreshed = result.current.refresh({ announce: true })
      })
      await act(async () => {
        await result.current.clear()
      })
      await act(async () => {
        pending.resolve(listOf(['old.txt']))
        await refreshed
      })
      expect(result.current.view).toEqual({ kind: 'none' })
      expect(result.current.isLoading).toBe(false)
      window.api.beginAgentChanges = vi
        .fn()
        .mockResolvedValueOnce({ kind: 'recording', startedAt: 200 })
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce(listOf(['x.txt', 'y.txt'], 200))
      await act(async () => {
        await result.current.begin()
        await result.current.refresh()
      })
      expect(result.current.view.kind === 'recording' && result.current.view.list?.totalCount).toBe(
        2
      )
      expect(toAnnouncementText(result.current.notice)).toBe(AGENT_CHANGES_CLEARED_NOTICE)
    })

    it('/a → /b → /a と戻った後に古い begin の結果が届いても、新しい記録の表示を上書きしない', async () => {
      const oldBegin = deferred<AgentChangesState>()
      window.api.beginAgentChanges = vi
        .fn()
        .mockReturnValueOnce(oldBegin.promise)
        .mockResolvedValueOnce({ kind: 'recording', startedAt: 200 })
      const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
        initialProps: { folder: '/a' as string | null }
      })
      let oldBegun: Promise<void> = Promise.resolve()
      act(() => {
        oldBegun = result.current.begin()
      })
      rerender({ folder: '/b' })
      rerender({ folder: '/a' })
      await act(async () => {
        await result.current.begin()
      })
      expect(result.current.view).toEqual({ kind: 'recording', startedAt: 200, list: null })
      // main ではフォルダの切り替えで古い記録が取り消され、none が返る
      await act(async () => {
        oldBegin.resolve({ kind: 'none' })
        await oldBegun
      })
      expect(result.current.view).toEqual({ kind: 'recording', startedAt: 200, list: null })
    })

    it('/a → /b → /a と戻った後に古い begin が失敗しても、新しい記録の表示を上書きしない', async () => {
      const oldBegin = deferred<AgentChangesState>()
      window.api.beginAgentChanges = vi
        .fn()
        .mockReturnValueOnce(oldBegin.promise)
        .mockResolvedValueOnce({ kind: 'recording', startedAt: 200 })
      const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
        initialProps: { folder: '/a' as string | null }
      })
      let oldBegun: Promise<void> = Promise.resolve()
      act(() => {
        oldBegun = result.current.begin()
      })
      rerender({ folder: '/b' })
      rerender({ folder: '/a' })
      await act(async () => {
        await result.current.begin()
      })
      await act(async () => {
        oldBegin.reject(new Error('ipc'))
        await oldBegun
      })
      expect(result.current.view).toEqual({ kind: 'recording', startedAt: 200, list: null })
    })

    it('begin の応答待ちで確認を終えたら、begin の結果で記録中に戻さない', async () => {
      const pending = deferred<AgentChangesState>()
      window.api.beginAgentChanges = vi.fn().mockReturnValueOnce(pending.promise)
      const { result } = renderHook(() => useAgentChanges('/repo'))
      let begun: Promise<void> = Promise.resolve()
      act(() => {
        begun = result.current.begin()
      })
      await act(async () => {
        await result.current.clear()
      })
      await act(async () => {
        pending.resolve(recordingState)
        await begun
      })
      expect(result.current.view).toEqual({ kind: 'none' })
    })

    it('読み上げを頼んだ取り直しで main に記録が無かったら依頼を捨てる(次の記録の無言の取り直しで読み上げない)', async () => {
      const { result } = renderHook(() => useAgentChanges('/repo'))
      await act(async () => {
        await result.current.begin()
      })
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce({ kind: 'none' })
      await act(async () => {
        await result.current.refresh({ announce: true })
      })
      expect(result.current.view).toEqual({ kind: 'none' })
      window.api.beginAgentChanges = vi
        .fn()
        .mockResolvedValueOnce({ kind: 'recording', startedAt: 200 })
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce(listOf(['x.txt'], 200))
      await act(async () => {
        await result.current.begin()
        await result.current.refresh()
      })
      expect(result.current.view.kind === 'recording' && result.current.view.list?.totalCount).toBe(
        1
      )
      expect(result.current.notice).toBeNull()
    })

    // L2-02: 「送ってある依頼の結果を捨てる」手順(世代・要求の番号・読み上げの保留・読み込み中)を、2 つの経路それぞれで固定する
    it('フォルダの切り替えは、その時点で読み込み中を下ろし、送ってある begin・一覧の結果と読み上げの依頼を捨てる', async () => {
      const pendingBegin = deferred<AgentChangesState>()
      const pendingList = deferred<AgentChangesListResult>()
      const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
        initialProps: { folder: '/a' as string | null }
      })
      await act(async () => {
        await result.current.begin()
      })
      window.api.beginAgentChanges = vi.fn().mockReturnValueOnce(pendingBegin.promise)
      window.api.listAgentChanges = vi.fn().mockReturnValueOnce(pendingList.promise)
      let begun: Promise<void> = Promise.resolve()
      let refreshed: Promise<void> = Promise.resolve()
      act(() => {
        refreshed = result.current.refresh({ announce: true })
        begun = result.current.begin()
      })
      expect(result.current.isLoading).toBe(true)
      expect(result.current.isBeginning).toBe(true)
      rerender({ folder: '/b' })
      // 応答を待たずに読み込み中を下ろす。begin は送ってあるので isBeginning は下ろさない(begin の数で数える)
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isBeginning).toBe(true)
      expect(result.current.view).toEqual({ kind: 'none' })
      await act(async () => {
        pendingList.resolve(listOf(['old.txt']))
        pendingBegin.resolve(recordingState)
        await refreshed
        await begun
      })
      expect(result.current.view).toEqual({ kind: 'none' })
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isBeginning).toBe(false)
      expect(result.current.notice).toBeNull()
      // 次のフォルダの記録の無言の取り直しで、前のフォルダの読み上げの依頼を使わない
      window.api.beginAgentChanges = vi
        .fn()
        .mockResolvedValueOnce({ kind: 'recording', startedAt: 200 })
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce(listOf(['x.txt'], 200))
      await act(async () => {
        await result.current.begin()
        await result.current.refresh()
      })
      expect(result.current.view.kind === 'recording' && result.current.view.list?.totalCount).toBe(
        1
      )
      expect(result.current.notice).toBeNull()
    })

    it('確認の終了は、main の応答を待つ前に読み込み中を下ろし、送ってある begin・一覧の結果と読み上げの依頼を捨てる。一覧のエラーは応答の後に消す', async () => {
      const pendingBegin = deferred<AgentChangesState>()
      const pendingList = deferred<AgentChangesListResult>()
      const pendingClear = deferred<void>()
      const { result } = renderHook(() => useAgentChanges('/repo'))
      await act(async () => {
        await result.current.begin()
        await result.current.refresh()
      })
      window.api.listAgentChanges = vi.fn().mockRejectedValueOnce(new Error('git failed'))
      await act(async () => {
        await result.current.refresh()
      })
      expect(result.current.listError).toBe('git failed')
      window.api.beginAgentChanges = vi.fn().mockReturnValueOnce(pendingBegin.promise)
      window.api.listAgentChanges = vi.fn().mockReturnValueOnce(pendingList.promise)
      window.api.clearAgentChanges = vi.fn().mockReturnValueOnce(pendingClear.promise)
      let begun: Promise<void> = Promise.resolve()
      let refreshed: Promise<void> = Promise.resolve()
      let cleared: Promise<void> = Promise.resolve()
      act(() => {
        refreshed = result.current.refresh({ announce: true })
        begun = result.current.begin()
      })
      expect(result.current.isLoading).toBe(true)
      act(() => {
        cleared = result.current.clear()
      })
      // main の応答の前: 読み込み中は下ろす。写し・一覧のエラーは応答の後に捨てる(順序を変えない)
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isBeginning).toBe(true)
      expect(result.current.listError).toBe('git failed')
      expect(result.current.view.kind).toBe('recording')
      // 確認の終了の応答待ちに届いた古い一覧・begin の結果は捨てる
      await act(async () => {
        pendingList.resolve(listOf(['old.txt', 'old2.txt']))
        pendingBegin.resolve({ kind: 'recording', startedAt: 300 })
        await refreshed
        await begun
      })
      expect(result.current.view.kind === 'recording' && result.current.view.startedAt).toBe(100)
      expect(result.current.view.kind === 'recording' && result.current.view.list?.totalCount).toBe(
        1
      )
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isBeginning).toBe(false)
      expect(result.current.notice).toBeNull()
      await act(async () => {
        pendingClear.resolve()
        await cleared
      })
      expect(result.current.view).toEqual({ kind: 'none' })
      expect(result.current.listError).toBeNull()
      expect(toAnnouncementText(result.current.notice)).toBe(AGENT_CHANGES_CLEARED_NOTICE)
      // 次の記録の無言の取り直しで、確認の終了の前の読み上げの依頼を使わない
      window.api.beginAgentChanges = vi
        .fn()
        .mockResolvedValueOnce({ kind: 'recording', startedAt: 200 })
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce(listOf(['x.txt'], 200))
      await act(async () => {
        await result.current.begin()
        await result.current.refresh()
      })
      expect(result.current.view.kind === 'recording' && result.current.view.list?.totalCount).toBe(
        1
      )
      expect(toAnnouncementText(result.current.notice)).toBe(AGENT_CHANGES_CLEARED_NOTICE)
    })

    it('確認の終了の応答待ちに始めた begin の結果は捨てない(捨てるのは確認の終了より前に送った依頼だけ)', async () => {
      const pendingClear = deferred<void>()
      const pendingBegin = deferred<AgentChangesState>()
      const { result } = renderHook(() => useAgentChanges('/repo'))
      await act(async () => {
        await result.current.begin()
      })
      window.api.clearAgentChanges = vi.fn().mockReturnValueOnce(pendingClear.promise)
      window.api.beginAgentChanges = vi.fn().mockReturnValueOnce(pendingBegin.promise)
      let cleared: Promise<void> = Promise.resolve()
      let begun: Promise<void> = Promise.resolve()
      act(() => {
        cleared = result.current.clear()
      })
      act(() => {
        begun = result.current.begin()
      })
      await act(async () => {
        pendingClear.resolve()
        await cleared
      })
      expect(result.current.view).toEqual({ kind: 'none' })
      await act(async () => {
        pendingBegin.resolve({ kind: 'recording', startedAt: 200 })
        await begun
      })
      expect(result.current.view).toEqual({ kind: 'recording', startedAt: 200, list: null })
    })

    it('begin を 2 回続けても、両方が終わるまで isBeginning を下ろさない', async () => {
      const first = deferred<AgentChangesState>()
      const second = deferred<AgentChangesState>()
      window.api.beginAgentChanges = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
      const { result } = renderHook(() => useAgentChanges('/repo'))
      let a: Promise<void> = Promise.resolve()
      let b: Promise<void> = Promise.resolve()
      act(() => {
        a = result.current.begin()
        b = result.current.begin()
      })
      expect(result.current.isBeginning).toBe(true)
      await act(async () => {
        first.resolve(recordingState)
        await a
      })
      expect(result.current.isBeginning).toBe(true)
      await act(async () => {
        second.resolve(recordingState)
        await b
      })
      expect(result.current.isBeginning).toBe(false)
    })
  })
})
