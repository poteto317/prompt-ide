import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type {
  AgentChangesListResult,
  AgentChangesRun,
  AgentChangesScope,
  AgentChangesState
} from '@shared/types'
import { useAgentChanges } from '../useAgentChanges'
import type { AgentChangesController } from '../useAgentChanges'
import { getListedAgentChanges } from '../../lib/agentChangesScope'
import { toAnnouncementText } from '../../lib/announcementText'
import { AGENT_CHANGES_CLEARED_NOTICE } from '../../lib/agentChangesMessages'
import {
  makeAgentChangeEntry,
  makeAgentChangesListResult,
  makeAgentChangesRecordingState,
  makeAgentChangesRecordingView,
  makeAgentChangesRun,
  makeAgentChangesScopeUnavailableListResult,
  makeAgentChangesUndoSummary
} from '../../__tests__/makeAgentChangesState'

const recordingState: AgentChangesState = makeAgentChangesRecordingState()
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
      await result.current.begin('manual')
    })
    expect(result.current.view).toEqual(makeAgentChangesRecordingView(null, { startedAt: 100 }))
    await act(async () => {
      await result.current.refresh({ announce: true })
    })
    expect(result.current.view).toEqual(
      makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
    )
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
      await result.current.begin('manual')
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
      await result.current.begin('manual')
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
      begun = result.current.begin('manual')
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
      await result.current.begin('manual')
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
    expect(getListedAgentChanges(result.current.view)?.totalCount).toBe(2)
    expect(toAnnouncementText(result.current.notice)).toBe('エージェントの変更: 2 件')
    expect(result.current.isLoading).toBe(false)
  })

  it('一覧の失敗は前回の一覧を残してエラーを出し、次の成功で消す', async () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin('manual')
      await result.current.refresh()
    })
    window.api.listAgentChanges = vi.fn().mockRejectedValueOnce(new Error('git failed'))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.listError).toBe('git failed')
    expect(getListedAgentChanges(result.current.view)?.totalCount).toBe(1)
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listOf([]))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.listError).toBeNull()
  })

  describe('静かな取り直し(quiet。自動の取り直し)', () => {
    async function recordingListed(): Promise<{ current: AgentChangesController }> {
      const { result } = renderHook(() => useAgentChanges('/repo'))
      await act(async () => {
        await result.current.begin('manual')
        await result.current.refresh()
      })
      return result
    }

    it('取り直しの間も isLoading を立てず、前の一覧を出したままにする', async () => {
      const result = await recordingListed()
      const before = result.current.view
      const pending = deferred<AgentChangesListResult>()
      window.api.listAgentChanges = vi.fn().mockReturnValueOnce(pending.promise)
      let done: Promise<void> = Promise.resolve()
      act(() => {
        done = result.current.refresh({ quiet: true })
      })
      expect(result.current.isLoading).toBe(false)
      expect(result.current.view).toBe(before)
      await act(async () => {
        pending.resolve(listOf(['a.txt']))
        await done
      })
      expect(result.current.isLoading).toBe(false)
    })

    it('一覧の中身が前と同じなら、写しを置き換えない(参照を保つ)', async () => {
      const result = await recordingListed()
      const before = result.current.view
      window.api.listAgentChanges = vi.fn().mockResolvedValue(listOf(['a.txt']))
      await act(async () => {
        await result.current.refresh({ quiet: true })
      })
      expect(window.api.listAgentChanges).toHaveBeenCalledOnce()
      expect(result.current.view).toBe(before)
    })

    it('失敗しても listError を立てず、前の一覧を出したままにする(戻すボタンを押せなくしない)', async () => {
      const result = await recordingListed()
      const before = result.current.view
      window.api.listAgentChanges = vi.fn().mockRejectedValueOnce(new Error('git failed'))
      await act(async () => {
        await result.current.refresh({ quiet: true })
      })
      expect(result.current.listError).toBeNull()
      expect(result.current.view).toBe(before)
      expect(result.current.isLoading).toBe(false)
    })

    it('手動の取り直しの失敗で出たエラーは、静かな取り直しの失敗では消さず、成功で消す', async () => {
      const result = await recordingListed()
      window.api.listAgentChanges = vi
        .fn()
        .mockRejectedValueOnce(new Error('manual failed'))
        .mockRejectedValueOnce(new Error('quiet failed'))
        .mockResolvedValueOnce(listOf(['a.txt']))
      await act(async () => {
        await result.current.refresh()
      })
      expect(result.current.listError).toBe('manual failed')
      await act(async () => {
        await result.current.refresh({ quiet: true })
      })
      expect(result.current.listError).toBe('manual failed')
      await act(async () => {
        await result.current.refresh({ quiet: true })
      })
      expect(result.current.listError).toBeNull()
    })

    it('手動の取り直しを追い越した静かな取り直しが失敗したら、手動と同じくエラーを出す(押した更新が黙って消えない)', async () => {
      const result = await recordingListed()
      const manual = deferred<AgentChangesListResult>()
      const quiet = deferred<AgentChangesListResult>()
      window.api.listAgentChanges = vi
        .fn()
        .mockReturnValueOnce(manual.promise)
        .mockReturnValueOnce(quiet.promise)
      let a: Promise<void> = Promise.resolve()
      let b: Promise<void> = Promise.resolve()
      act(() => {
        a = result.current.refresh()
      })
      act(() => {
        b = result.current.refresh({ quiet: true })
      })
      await act(async () => {
        quiet.reject(new Error('git failed'))
        await b
        manual.resolve(listOf(['old.txt']))
        await a
      })
      expect(result.current.listError).toBe('git failed')
      expect(result.current.isLoading).toBe(false)
      // 手動の依頼に答えた後の静かな取り直しの失敗は、今までどおりエラーを出さない
      window.api.listAgentChanges = vi
        .fn()
        .mockResolvedValueOnce(listOf(['a.txt']))
        .mockRejectedValueOnce(new Error('quiet failed'))
      await act(async () => {
        await result.current.refresh({ quiet: true })
        await result.current.refresh({ quiet: true })
      })
      expect(result.current.listError).toBeNull()
    })

    it('手動の取り直しの応答待ちにフォルダを切り替えた後は、静かな取り直しが失敗してもエラーを出さない', async () => {
      const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
        initialProps: { folder: '/a' as string | null }
      })
      await act(async () => {
        await result.current.begin('manual')
      })
      const manual = deferred<AgentChangesListResult>()
      window.api.listAgentChanges = vi.fn().mockReturnValueOnce(manual.promise)
      let a: Promise<void> = Promise.resolve()
      act(() => {
        a = result.current.refresh()
      })
      rerender({ folder: '/b' })
      await act(async () => {
        manual.resolve(listOf(['old.txt']))
        await a
        await result.current.begin('manual')
      })
      window.api.listAgentChanges = vi.fn().mockRejectedValueOnce(new Error('quiet failed'))
      await act(async () => {
        await result.current.refresh({ quiet: true })
      })
      expect(result.current.listError).toBeNull()
    })

    it('一覧が変わったら、写しを置き換える', async () => {
      const result = await recordingListed()
      const before = result.current.view
      window.api.listAgentChanges = vi.fn().mockResolvedValue(listOf(['a.txt', 'b.txt']))
      await act(async () => {
        await result.current.refresh({ quiet: true })
      })
      expect(result.current.view).not.toBe(before)
      expect(getListedAgentChanges(result.current.view)?.totalCount).toBe(2)
    })

    it('HEAD の帯(headChanged)だけが変わっても、写しを置き換える', async () => {
      const result = await recordingListed()
      window.api.listAgentChanges = vi
        .fn()
        .mockResolvedValue(
          makeAgentChangesListResult([makeAgentChangeEntry('a.txt')], { headChanged: true })
        )
      await act(async () => {
        await result.current.refresh({ quiet: true })
      })
      expect(getListedAgentChanges(result.current.view)?.headChanged).toBe(true)
    })

    it('手動の取り直しの途中に静かな取り直しが追い越しても、isLoading を下ろす', async () => {
      const result = await recordingListed()
      const manual = deferred<AgentChangesListResult>()
      const quiet = deferred<AgentChangesListResult>()
      window.api.listAgentChanges = vi
        .fn()
        .mockReturnValueOnce(manual.promise)
        .mockReturnValueOnce(quiet.promise)
      let a: Promise<void> = Promise.resolve()
      let b: Promise<void> = Promise.resolve()
      act(() => {
        a = result.current.refresh()
      })
      expect(result.current.isLoading).toBe(true)
      act(() => {
        b = result.current.refresh({ quiet: true })
      })
      await act(async () => {
        quiet.resolve(listOf(['a.txt', 'b.txt']))
        await b
        manual.resolve(listOf(['old.txt']))
        await a
      })
      expect(getListedAgentChanges(result.current.view)?.totalCount).toBe(2)
      expect(result.current.isLoading).toBe(false)
    })

    it('静かな取り直しが一覧を反映するたびに、一覧が同じでも quietRefreshCount を進める(手動・失敗・捨てた結果では進めない)', async () => {
      const result = await recordingListed()
      expect(result.current.quietRefreshCount).toBe(0)
      await act(async () => {
        await result.current.refresh({ quiet: true })
      })
      expect(result.current.quietRefreshCount).toBe(1)
      await act(async () => {
        await result.current.refresh()
      })
      expect(result.current.quietRefreshCount).toBe(1)
      window.api.listAgentChanges = vi.fn().mockRejectedValueOnce(new Error('git failed'))
      await act(async () => {
        await result.current.refresh({ quiet: true })
      })
      expect(result.current.quietRefreshCount).toBe(1)
      // 後の依頼に追い越された静かな取り直しの結果では進めない
      const first = deferred<AgentChangesListResult>()
      window.api.listAgentChanges = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(listOf(['a.txt']))
      let a: Promise<void> = Promise.resolve()
      act(() => {
        a = result.current.refresh({ quiet: true })
      })
      await act(async () => {
        await result.current.refresh()
        first.resolve(listOf(['a.txt']))
        await a
      })
      expect(result.current.quietRefreshCount).toBe(1)
    })

    it('手動の取り直しは、一覧が同じでも写しを置き換える(diff タブを取り直す契機を変えない)', async () => {
      const result = await recordingListed()
      const before = result.current.view
      await act(async () => {
        await result.current.refresh()
      })
      expect(result.current.view).not.toBe(before)
      expect(result.current.view).toEqual(before)
    })
  })

  it('main が記録を捨てていたら(一覧が none)記録なしにする', async () => {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin('manual')
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
      await result.current.begin('manual')
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
    window.api.beginAgentChanges = vi
      .fn()
      .mockResolvedValue(makeAgentChangesRecordingState({ startedAt: 200 }))
    await act(async () => {
      await result.current.begin('manual')
    })
    expect(result.current.savedPaths.size).toBe(0)
  })

  it('フォルダが変わったら記録の写しと保存したパスを捨てる', async () => {
    const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
      initialProps: { folder: '/a' as string | null }
    })
    await act(async () => {
      await result.current.begin('manual')
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
      expect(result.current.view).toEqual(makeAgentChangesRecordingView(null, { startedAt: 100 }))
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
      .mockResolvedValue(makeAgentChangesRecordingState({ startedAt: 300 }))
    rerender({ f: '/b' })
    await waitFor(() =>
      expect(result.current.view).toEqual(makeAgentChangesRecordingView(null, { startedAt: 300 }))
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
        await result.current.begin('manual')
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
        .mockResolvedValueOnce(makeAgentChangesRecordingState({ startedAt: 200 }))
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce(listOf(['x.txt', 'y.txt'], 200))
      await act(async () => {
        await result.current.begin('manual')
        await result.current.refresh()
      })
      expect(getListedAgentChanges(result.current.view)?.totalCount).toBe(2)
      expect(result.current.notice).toBeNull()
    })

    it('読み上げを頼んだ取り直しが失敗したら依頼を捨てる(後の無言の取り直しで読み上げない)', async () => {
      const { result } = renderHook(() => useAgentChanges('/repo'))
      await act(async () => {
        await result.current.begin('manual')
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
        await result.current.begin('manual')
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
        .mockResolvedValueOnce(makeAgentChangesRecordingState({ startedAt: 200 }))
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce(listOf(['x.txt', 'y.txt'], 200))
      await act(async () => {
        await result.current.begin('manual')
        await result.current.refresh()
      })
      expect(getListedAgentChanges(result.current.view)?.totalCount).toBe(2)
      expect(toAnnouncementText(result.current.notice)).toBe(AGENT_CHANGES_CLEARED_NOTICE)
    })

    it('/a → /b → /a と戻った後に古い begin の結果が届いても、新しい記録の表示を上書きしない', async () => {
      const oldBegin = deferred<AgentChangesState>()
      window.api.beginAgentChanges = vi
        .fn()
        .mockReturnValueOnce(oldBegin.promise)
        .mockResolvedValueOnce(makeAgentChangesRecordingState({ startedAt: 200 }))
      const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
        initialProps: { folder: '/a' as string | null }
      })
      let oldBegun: Promise<void> = Promise.resolve()
      act(() => {
        oldBegun = result.current.begin('manual')
      })
      rerender({ folder: '/b' })
      rerender({ folder: '/a' })
      await act(async () => {
        await result.current.begin('manual')
      })
      expect(result.current.view).toEqual(makeAgentChangesRecordingView(null, { startedAt: 200 }))
      // main ではフォルダの切り替えで古い記録が取り消され、none が返る
      await act(async () => {
        oldBegin.resolve({ kind: 'none' })
        await oldBegun
      })
      expect(result.current.view).toEqual(makeAgentChangesRecordingView(null, { startedAt: 200 }))
    })

    it('/a → /b → /a と戻った後に古い begin が失敗しても、新しい記録の表示を上書きしない', async () => {
      const oldBegin = deferred<AgentChangesState>()
      window.api.beginAgentChanges = vi
        .fn()
        .mockReturnValueOnce(oldBegin.promise)
        .mockResolvedValueOnce(makeAgentChangesRecordingState({ startedAt: 200 }))
      const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
        initialProps: { folder: '/a' as string | null }
      })
      let oldBegun: Promise<void> = Promise.resolve()
      act(() => {
        oldBegun = result.current.begin('manual')
      })
      rerender({ folder: '/b' })
      rerender({ folder: '/a' })
      await act(async () => {
        await result.current.begin('manual')
      })
      await act(async () => {
        oldBegin.reject(new Error('ipc'))
        await oldBegun
      })
      expect(result.current.view).toEqual(makeAgentChangesRecordingView(null, { startedAt: 200 }))
    })

    it('begin の応答待ちで確認を終えたら、begin の結果で記録中に戻さない', async () => {
      const pending = deferred<AgentChangesState>()
      window.api.beginAgentChanges = vi.fn().mockReturnValueOnce(pending.promise)
      const { result } = renderHook(() => useAgentChanges('/repo'))
      let begun: Promise<void> = Promise.resolve()
      act(() => {
        begun = result.current.begin('manual')
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
        await result.current.begin('manual')
      })
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce({ kind: 'none' })
      await act(async () => {
        await result.current.refresh({ announce: true })
      })
      expect(result.current.view).toEqual({ kind: 'none' })
      window.api.beginAgentChanges = vi
        .fn()
        .mockResolvedValueOnce(makeAgentChangesRecordingState({ startedAt: 200 }))
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce(listOf(['x.txt'], 200))
      await act(async () => {
        await result.current.begin('manual')
        await result.current.refresh()
      })
      expect(getListedAgentChanges(result.current.view)?.totalCount).toBe(1)
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
        await result.current.begin('manual')
      })
      window.api.beginAgentChanges = vi.fn().mockReturnValueOnce(pendingBegin.promise)
      window.api.listAgentChanges = vi.fn().mockReturnValueOnce(pendingList.promise)
      let begun: Promise<void> = Promise.resolve()
      let refreshed: Promise<void> = Promise.resolve()
      act(() => {
        refreshed = result.current.refresh({ announce: true })
        begun = result.current.begin('manual')
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
        .mockResolvedValueOnce(makeAgentChangesRecordingState({ startedAt: 200 }))
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce(listOf(['x.txt'], 200))
      await act(async () => {
        await result.current.begin('manual')
        await result.current.refresh()
      })
      expect(getListedAgentChanges(result.current.view)?.totalCount).toBe(1)
      expect(result.current.notice).toBeNull()
    })

    it('確認の終了は、main の応答を待つ前に読み込み中を下ろし、送ってある begin・一覧の結果と読み上げの依頼を捨てる。一覧のエラーは応答の後に消す', async () => {
      const pendingBegin = deferred<AgentChangesState>()
      const pendingList = deferred<AgentChangesListResult>()
      const pendingClear = deferred<void>()
      const { result } = renderHook(() => useAgentChanges('/repo'))
      await act(async () => {
        await result.current.begin('manual')
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
        begun = result.current.begin('manual')
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
        pendingBegin.resolve(makeAgentChangesRecordingState({ startedAt: 300 }))
        await refreshed
        await begun
      })
      expect(result.current.view.kind === 'recording' && result.current.view.startedAt).toBe(100)
      expect(getListedAgentChanges(result.current.view)?.totalCount).toBe(1)
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
        .mockResolvedValueOnce(makeAgentChangesRecordingState({ startedAt: 200 }))
      window.api.listAgentChanges = vi.fn().mockResolvedValueOnce(listOf(['x.txt'], 200))
      await act(async () => {
        await result.current.begin('manual')
        await result.current.refresh()
      })
      expect(getListedAgentChanges(result.current.view)?.totalCount).toBe(1)
      expect(toAnnouncementText(result.current.notice)).toBe(AGENT_CHANGES_CLEARED_NOTICE)
    })

    it('確認の終了の応答待ちに始めた begin の結果は捨てない(捨てるのは確認の終了より前に送った依頼だけ)', async () => {
      const pendingClear = deferred<void>()
      const pendingBegin = deferred<AgentChangesState>()
      const { result } = renderHook(() => useAgentChanges('/repo'))
      await act(async () => {
        await result.current.begin('manual')
      })
      window.api.clearAgentChanges = vi.fn().mockReturnValueOnce(pendingClear.promise)
      window.api.beginAgentChanges = vi.fn().mockReturnValueOnce(pendingBegin.promise)
      let cleared: Promise<void> = Promise.resolve()
      let begun: Promise<void> = Promise.resolve()
      act(() => {
        cleared = result.current.clear()
      })
      act(() => {
        begun = result.current.begin('manual')
      })
      await act(async () => {
        pendingClear.resolve()
        await cleared
      })
      expect(result.current.view).toEqual({ kind: 'none' })
      await act(async () => {
        pendingBegin.resolve(makeAgentChangesRecordingState({ startedAt: 200 }))
        await begun
      })
      expect(result.current.view).toEqual(makeAgentChangesRecordingView(null, { startedAt: 200 }))
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
        a = result.current.begin('manual')
        b = result.current.begin('manual')
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

describe('useAgentChanges の範囲と実行', () => {
  const run1 = makeAgentChangesRun({ runId: 1, number: 1, startedAt: 100, endedAt: 200 })
  const run2 = makeAgentChangesRun({ runId: 2, number: 2, startedAt: 200 })
  const listIn = (
    scope: AgentChangesScope,
    paths: string[],
    runs: AgentChangesRun[] = [run1, run2]
  ): AgentChangesListResult =>
    makeAgentChangesListResult(
      paths.map((path) => makeAgentChangeEntry(path)),
      { scope, runs }
    )
  const RUN_1: AgentChangesScope = { kind: 'run', runId: 1 }

  // 記録中(実行 1・2)にして累積の一覧を取った状態にする
  async function recordingTwoRuns(): Promise<{ current: AgentChangesController }> {
    window.api.beginAgentChanges = vi
      .fn()
      .mockResolvedValue(makeAgentChangesRecordingState({ runs: [run1, run2] }))
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listIn({ kind: 'all' }, ['a.txt']))
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin('send')
      await result.current.refresh()
    })
    return result
  }

  // 実行 1 を選んだ記録中にする(範囲を累積に戻す契機・実行が消えたときの前提)
  async function recordingWithRun1Selected(): Promise<{ current: AgentChangesController }> {
    const result = await recordingTwoRuns()
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listIn(RUN_1, ['a.txt']))
    await act(async () => {
      result.current.selectScope(RUN_1)
    })
    expect(result.current.scope).toEqual(RUN_1)
    return result
  }

  it('begin は trigger を main へ渡し、写しに実行の一覧を持つ', async () => {
    const result = await recordingTwoRuns()
    expect(window.api.beginAgentChanges).toHaveBeenCalledWith('send')
    expect(result.current.view).toMatchObject({ kind: 'recording', runs: [run1, run2] })
    expect(result.current.scope).toEqual({ kind: 'all' })
  })

  it('範囲を選ぶと一覧を空にして、その範囲で取り直す', async () => {
    const result = await recordingTwoRuns()
    const pending = deferred<AgentChangesListResult>()
    window.api.listAgentChanges = vi.fn(() => pending.promise)
    act(() => result.current.selectScope(RUN_1))
    expect(result.current.scope).toEqual(RUN_1)
    expect(result.current.view).toMatchObject({ kind: 'recording', list: null })
    expect(window.api.listAgentChanges).toHaveBeenCalledWith(RUN_1)
    await act(async () => {
      pending.resolve(listIn(RUN_1, ['b.txt']))
    })
    expect(result.current.view).toMatchObject({
      kind: 'recording',
      list: { kind: 'listed', scope: RUN_1, entries: [{ path: 'b.txt' }] }
    })
  })

  it('範囲の違う古い一覧の結果を捨てる(L-040)', async () => {
    const result = await recordingTwoRuns()
    const old = deferred<AgentChangesListResult>()
    const fresh = deferred<AgentChangesListResult>()
    window.api.listAgentChanges = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise)
    let refreshing: Promise<void> = Promise.resolve()
    act(() => {
      refreshing = result.current.refresh()
    })
    act(() => result.current.selectScope(RUN_1))
    await act(async () => {
      old.resolve(listIn({ kind: 'all' }, ['old.txt']))
      await refreshing
    })
    expect(result.current.view).toMatchObject({ list: null })
    await act(async () => {
      fresh.resolve(listIn(RUN_1, ['b.txt']))
    })
    expect(result.current.view).toMatchObject({
      list: { scope: RUN_1, entries: [{ path: 'b.txt' }] }
    })
  })

  it('main が run-missing を返したら、範囲を累積に戻して取り直し、消える前の番号で読み上げる', async () => {
    const result = await recordingTwoRuns()
    window.api.listAgentChanges = vi
      .fn()
      .mockResolvedValueOnce(
        makeAgentChangesScopeUnavailableListResult(RUN_1, 'run-missing', { runs: [run2] })
      )
      .mockResolvedValueOnce(listIn({ kind: 'all' }, ['a.txt'], [run2]))
    await act(async () => {
      result.current.selectScope(RUN_1)
    })
    await waitFor(() =>
      expect(result.current.view).toMatchObject({
        list: { kind: 'listed', scope: { kind: 'all' } }
      })
    )
    expect(result.current.scope).toEqual({ kind: 'all' })
    expect(window.api.listAgentChanges).toHaveBeenLastCalledWith({ kind: 'all' })
    expect(toAnnouncementText(result.current.notice)).toBe(
      '実行 1 の記録は古くなったため消えました。すべて（累積）を表示します'
    )
  })

  it('begin の結果の実行の一覧に選んでいる実行が無ければ、範囲を累積に戻して取り直し、読み上げる', async () => {
    const result = await recordingWithRun1Selected()
    window.api.beginAgentChanges = vi
      .fn()
      .mockResolvedValue(makeAgentChangesRecordingState({ runs: [run2] }))
    window.api.listAgentChanges = vi
      .fn()
      .mockResolvedValue(listIn({ kind: 'all' }, ['a.txt'], [run2]))
    await act(async () => {
      await result.current.begin('send')
    })
    await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalledWith({ kind: 'all' }))
    expect(result.current.scope).toEqual({ kind: 'all' })
    expect(toAnnouncementText(result.current.notice)).toBe(
      '実行 1 の記録は古くなったため消えました。すべて（累積）を表示します'
    )
  })

  it('範囲の一覧が取れない(start-not-recorded など)ときは、一覧の代わりに理由を持つ', async () => {
    const result = await recordingTwoRuns()
    window.api.listAgentChanges = vi.fn().mockResolvedValue(
      makeAgentChangesScopeUnavailableListResult(RUN_1, 'end-not-recorded', {
        runs: [run1, run2]
      })
    )
    await act(async () => {
      result.current.selectScope(RUN_1)
    })
    await waitFor(() =>
      expect(result.current.view).toMatchObject({
        list: { kind: 'scope-unavailable', scope: RUN_1, reason: 'end-not-recorded' }
      })
    )
    expect(result.current.scope).toEqual(RUN_1)
  })

  it('範囲の一覧が取れないまま静かな取り直しが続いても、写しの参照を保ち、quietRefreshCount を進める', async () => {
    const result = await recordingTwoRuns()
    window.api.listAgentChanges = vi.fn().mockResolvedValue(
      makeAgentChangesScopeUnavailableListResult(RUN_1, 'end-not-recorded', {
        runs: [run1, run2]
      })
    )
    await act(async () => {
      result.current.selectScope(RUN_1)
    })
    await waitFor(() =>
      expect(result.current.view).toMatchObject({ list: { kind: 'scope-unavailable' } })
    )
    const before = result.current.view
    const count = result.current.quietRefreshCount
    await act(async () => {
      await result.current.refresh({ quiet: true })
    })
    expect(result.current.view).toBe(before)
    expect(result.current.quietRefreshCount).toBe(count + 1)
  })

  it('記録がある間の send の begin が例外になっても、写しを変えない', async () => {
    const result = await recordingTwoRuns()
    const before = result.current.view
    window.api.beginAgentChanges = vi.fn().mockRejectedValue(new Error('ipc'))
    await act(async () => {
      await result.current.begin('send')
    })
    expect(result.current.view).toBe(before)
  })

  it('新しい記録(startedAt が変わった)になると、範囲を累積に戻す', async () => {
    const result = await recordingWithRun1Selected()
    const fresh = makeAgentChangesRecordingState({ startedAt: 999, runs: [run1] })
    window.api.getAgentChangesState = vi.fn().mockResolvedValue(fresh)
    window.api.beginAgentChanges = vi.fn().mockResolvedValue(fresh)
    await act(async () => {
      await result.current.begin('manual')
    })
    expect(result.current.scope).toEqual({ kind: 'all' })
  })

  it('確認を終えると、範囲を累積に戻す', async () => {
    const result = await recordingWithRun1Selected()
    await act(async () => {
      await result.current.clear()
    })
    expect(result.current.scope).toEqual({ kind: 'all' })
  })

  it('フォルダを切り替えると、範囲を累積に戻す', async () => {
    window.api.beginAgentChanges = vi
      .fn()
      .mockResolvedValue(makeAgentChangesRecordingState({ runs: [run1, run2] }))
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listIn(RUN_1, ['a.txt']))
    const { result, rerender } = renderHook(({ folder }) => useAgentChanges(folder), {
      initialProps: { folder: '/a' as string | null }
    })
    await act(async () => {
      await result.current.begin('send')
      result.current.selectScope(RUN_1)
    })
    expect(result.current.scope).toEqual(RUN_1)
    rerender({ folder: '/b' })
    expect(result.current.scope).toEqual({ kind: 'all' })
  })
})

describe('取り消しの控えの写し', () => {
  const summary = makeAgentChangesUndoSummary()

  async function recording(): Promise<{ current: AgentChangesController }> {
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await act(async () => {
      await result.current.begin('manual')
    })
    return result
  }

  const undoOf = (view: AgentChangesController['view']): unknown =>
    view.kind === 'recording' ? view.undo : undefined

  it('getAgentChangesState の undo を写す', async () => {
    window.api.getAgentChangesState = vi
      .fn()
      .mockResolvedValue(makeAgentChangesRecordingState({ undo: summary }))
    const { result } = renderHook(() => useAgentChanges('/repo'))
    await waitFor(() => expect(undoOf(result.current.view)).toEqual(summary))
  })

  it('一覧の取り直しの結果の undo を写す', async () => {
    const result = await recording()
    window.api.listAgentChanges = vi
      .fn()
      .mockResolvedValue(makeAgentChangesListResult([], { undo: summary }))
    await act(async () => {
      await result.current.refresh()
    })
    expect(undoOf(result.current.view)).toEqual(summary)
  })

  it('applyUndoSummary は同じ記録(startedAt)の写しの undo を置き換える', async () => {
    const result = await recording()
    act(() => {
      result.current.applyUndoSummary(summary, 100)
    })
    expect(undoOf(result.current.view)).toBe(summary)
    act(() => {
      result.current.applyUndoSummary(null, 100)
    })
    expect(undoOf(result.current.view)).toBeNull()
  })

  it('startedAt が違う・記録中でないなら捨てる(写しは変わらない)', async () => {
    const result = await recording()
    const before = result.current.view
    act(() => {
      result.current.applyUndoSummary(summary, 999)
    })
    expect(result.current.view).toBe(before)
    await act(async () => {
      await result.current.clear()
    })
    act(() => {
      result.current.applyUndoSummary(summary, 100)
    })
    expect(result.current.view).toEqual({ kind: 'none' })
  })

  it('戻す操作の結果の到着の前に新しい記録を始めたら、前の記録の startedAt での反映は捨て、新しい記録に帯を出さない', async () => {
    const result = await recording()
    // 依頼の時点の写しの startedAt を控えておき、結果の到着の前に確認を終えて新しい記録を始める
    const requestedAt = result.current.view.kind === 'recording' ? result.current.view.startedAt : 0
    window.api.beginAgentChanges = vi
      .fn()
      .mockResolvedValue(makeAgentChangesRecordingState({ startedAt: 200 }))
    await act(async () => {
      await result.current.clear()
      await result.current.begin('manual')
    })
    act(() => {
      result.current.applyUndoSummary(summary, requestedAt)
    })
    expect(result.current.view).toMatchObject({ kind: 'recording', startedAt: 200, undo: null })
  })

  it('静かな取り直しは undo だけが変わったときも写しを置き換え、undo も同じなら置き換えない(L-423)', async () => {
    const result = await recording()
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listOf(['a.txt']))
    await act(async () => {
      await result.current.refresh()
    })
    const before = result.current.view
    const withUndo = makeAgentChangesListResult([makeAgentChangeEntry('a.txt')], { undo: summary })
    window.api.listAgentChanges = vi.fn().mockResolvedValue(withUndo)
    await act(async () => {
      await result.current.refresh({ quiet: true })
    })
    expect(result.current.view).not.toBe(before)
    expect(undoOf(result.current.view)).toEqual(summary)
    const replaced = result.current.view
    window.api.listAgentChanges = vi.fn().mockResolvedValue(
      makeAgentChangesListResult([makeAgentChangeEntry('a.txt')], {
        undo: makeAgentChangesUndoSummary()
      })
    )
    await act(async () => {
      await result.current.refresh({ quiet: true })
    })
    expect(result.current.view).toBe(replaced)
  })
})
