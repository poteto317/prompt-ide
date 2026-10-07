import { describe, it, expect, vi } from 'vitest'
import {
  makeAgentChangeEntry,
  makeAgentChangesList,
  makeAgentChangesRecordingView,
  makeAgentChangesListResult,
  makeAgentChangesController,
  makeAgentChangesRevertState,
  makeAgentChangesPanelState
} from '../makeAgentChangesState'

describe('makeAgentChangeEntry', () => {
  it('既定は status M・ファイル・記録済み', () => {
    expect(makeAgentChangeEntry('a.txt')).toEqual({
      path: 'a.txt',
      status: 'M',
      isDirectory: false,
      notRecorded: false
    })
  })

  it('指定した項目だけを上書きする', () => {
    expect(makeAgentChangeEntry('dir/', { status: 'A', isDirectory: true })).toEqual({
      path: 'dir/',
      status: 'A',
      isDirectory: true,
      notRecorded: false
    })
  })
})

describe('makeAgentChangesList', () => {
  it('既定は totalCount が entries の数・打ち切りなし・HEAD は変わっていない', () => {
    const entries = [makeAgentChangeEntry('a.txt'), makeAgentChangeEntry('b.txt')]
    expect(makeAgentChangesList(entries)).toEqual({
      entries,
      totalCount: 2,
      truncated: false,
      headChanged: false
    })
  })

  it('指定した項目だけを上書きする', () => {
    expect(makeAgentChangesList([], { totalCount: 600, truncated: true })).toEqual({
      entries: [],
      totalCount: 600,
      truncated: true,
      headChanged: false
    })
  })
})

describe('makeAgentChangesRecordingView', () => {
  it('既定は startedAt 100 の記録中で、一覧は makeAgentChangesList の既定', () => {
    const entries = [makeAgentChangeEntry('a.txt')]
    expect(makeAgentChangesRecordingView(entries)).toEqual({
      kind: 'recording',
      startedAt: 100,
      list: { entries, totalCount: 1, truncated: false, headChanged: false }
    })
  })

  it('entries が null なら一覧を取っていない記録中', () => {
    expect(makeAgentChangesRecordingView(null, { startedAt: 1 })).toEqual({
      kind: 'recording',
      startedAt: 1,
      list: null
    })
  })

  it('startedAt と一覧の項目を上書きする', () => {
    expect(
      makeAgentChangesRecordingView([], { startedAt: 5, totalCount: 9, headChanged: true })
    ).toEqual({
      kind: 'recording',
      startedAt: 5,
      list: { entries: [], totalCount: 9, truncated: false, headChanged: true }
    })
  })
})

describe('makeAgentChangesListResult', () => {
  it('既定は startedAt 100 の recording で、一覧は makeAgentChangesList の既定', () => {
    const entries = [makeAgentChangeEntry('a.txt')]
    expect(makeAgentChangesListResult(entries)).toEqual({
      kind: 'recording',
      startedAt: 100,
      entries,
      totalCount: 1,
      truncated: false,
      headChanged: false
    })
  })

  it('指定した項目だけを上書きする', () => {
    expect(makeAgentChangesListResult([], { startedAt: 7, truncated: true })).toEqual({
      kind: 'recording',
      startedAt: 7,
      entries: [],
      totalCount: 0,
      truncated: true,
      headChanged: false
    })
  })
})

describe('makeAgentChangesController', () => {
  it('既定は記録なし・読み込みなし・失敗なし・通知なし・保存したパスなしで、操作は resolve するモック', async () => {
    const controller = makeAgentChangesController()
    expect(controller).toMatchObject({
      view: { kind: 'none' },
      isLoading: false,
      isBeginning: false,
      listError: null,
      notice: null
    })
    expect(controller.savedPaths.size).toBe(0)
    for (const fn of [controller.begin, controller.refresh, controller.clear]) {
      expect(vi.isMockFunction(fn)).toBe(true)
      await expect(fn()).resolves.toBeUndefined()
    }
    expect(vi.isMockFunction(controller.markSaved)).toBe(true)
    expect(vi.isMockFunction(controller.announce)).toBe(true)
  })

  it('呼ぶたびに別のモックを作る(テスト間で呼び出しの記録を共有しない)', () => {
    expect(makeAgentChangesController().begin).not.toBe(makeAgentChangesController().begin)
  })

  it('指定した項目だけを上書きする', () => {
    const view = makeAgentChangesRecordingView(null)
    const controller = makeAgentChangesController({ view, listError: 'failed' })
    expect(controller.view).toBe(view)
    expect(controller.listError).toBe('failed')
    expect(controller.isLoading).toBe(false)
  })
})

describe('makeAgentChangesRevertState', () => {
  it('既定は押せる・実行していない・失敗なしで、操作は resolve するモック', async () => {
    const state = makeAgentChangesRevertState()
    expect(state).toMatchObject({
      isReverting: false,
      error: null,
      revertDisabledReason: null,
      revertAllDisabledReason: null
    })
    await expect(state.revertFile(makeAgentChangeEntry('a.txt'))).resolves.toBeUndefined()
    await expect(state.revertHunk('a.txt', 'patch', '@@')).resolves.toBeUndefined()
    await expect(state.revertAll()).resolves.toBeUndefined()
    expect(vi.isMockFunction(state.revertFile)).toBe(true)
    expect(vi.isMockFunction(state.revertHunk)).toBe(true)
    expect(vi.isMockFunction(state.revertAll)).toBe(true)
  })

  it('指定した項目だけを上書きする', () => {
    const state = makeAgentChangesRevertState({ error: 'failed', revertDisabledReason: 'busy' })
    expect(state.error).toBe('failed')
    expect(state.revertDisabledReason).toBe('busy')
    expect(state.revertAllDisabledReason).toBeNull()
  })
})

describe('makeAgentChangesPanelState', () => {
  it('既定はエージェント CLI 方式・フォルダ /repo・フォーカスの依頼なしで、changes・revert は各ファクトリの既定', () => {
    const state = makeAgentChangesPanelState()
    expect(state.isAgentMode).toBe(true)
    expect(state.folderPath).toBe('/repo')
    expect(state.focusRequest.isRequested).toBe(false)
    expect(vi.isMockFunction(state.focusRequest.consume)).toBe(true)
    expect(vi.isMockFunction(state.onOpenDiff)).toBe(true)
    expect(state.changes.view).toEqual({ kind: 'none' })
    expect(state.revert.revertDisabledReason).toBeNull()
  })

  it('指定した項目だけを上書きする', () => {
    const changes = makeAgentChangesController({ isLoading: true })
    const state = makeAgentChangesPanelState({ changes, isAgentMode: false })
    expect(state.changes).toBe(changes)
    expect(state.isAgentMode).toBe(false)
    expect(state.folderPath).toBe('/repo')
  })
})
