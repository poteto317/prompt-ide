import { describe, it, expect } from 'vitest'
import {
  AGENT_UNDO_CHANGED_MESSAGE,
  AGENT_UNDO_PREPARE_FAILED_MESSAGE,
  AGENT_UNDO_SAVED_MISSING_MESSAGE,
  summarizeAgentChangesUndo,
  toAgentChangesUndoResult,
  toAgentRevertUndoOutcome,
  undoActionOf,
  undoPrecheckRejection,
  undoPrepareFailedMessage,
  undoStopExecution,
  undoStoppedExecution
} from '../agentChangesUndoModel'
import type {
  AgentChangesUndoAfter,
  AgentChangesUndoBefore,
  AgentChangesUndoProgress,
  AgentChangesUndoStop
} from '../agentChangesUndoModel'

// 控えの型と結果の純粋な変換(ファイルを読み書きせずに検査する)

const FILE_BEFORE: AgentChangesUndoBefore = { kind: 'file', savedName: '0', mode: 0o644 }
const FILE_AFTER: AgentChangesUndoAfter = {
  kind: 'file',
  size: 1,
  sha256: 'a'.repeat(64),
  mode: 0o644
}
const ABSENT = { kind: 'absent' } as const

describe('undoActionOf(取り消しの動作)', () => {
  it('戻す前に無かった → ゴミ箱へ移す(戻した後の状態によらない)', () => {
    expect(undoActionOf({ before: ABSENT, after: FILE_AFTER })).toBe('trash')
    expect(undoActionOf({ before: ABSENT, after: { kind: 'symlink', target: 'x' } })).toBe('trash')
  })

  it('戻した後に無い → 作り直す', () => {
    expect(undoActionOf({ before: FILE_BEFORE, after: ABSENT })).toBe('recreate')
    expect(undoActionOf({ before: { kind: 'symlink', target: 'x' }, after: ABSENT })).toBe(
      'recreate'
    )
  })

  it('どちらもある → 書き戻す', () => {
    expect(undoActionOf({ before: FILE_BEFORE, after: FILE_AFTER })).toBe('rewrite')
    expect(undoActionOf({ before: { kind: 'symlink', target: 'x' }, after: FILE_AFTER })).toBe(
      'rewrite'
    )
  })
})

describe('summarizeAgentChangesUndo(renderer に渡す要約)', () => {
  it('控えが無ければ null', () => {
    expect(summarizeAgentChangesUndo(null)).toBeNull()
  })

  it('undoId・操作・パスごとの動作だけを渡す(一時ディレクトリ・指紋は渡さない)', () => {
    expect(
      summarizeAgentChangesUndo({
        undoId: 3,
        operation: 'all',
        dir: '/tmp/undo',
        items: [
          { path: 'a.txt', before: FILE_BEFORE, after: FILE_AFTER },
          { path: 'b.txt', before: ABSENT, after: FILE_AFTER },
          { path: 'c.txt', before: FILE_BEFORE, after: ABSENT }
        ]
      })
    ).toEqual({
      undoId: 3,
      operation: 'all',
      entries: [
        { path: 'a.txt', action: 'rewrite' },
        { path: 'b.txt', action: 'trash' },
        { path: 'c.txt', action: 'recreate' }
      ]
    })
  })
})

describe('toAgentRevertUndoOutcome(戻す操作の結果に入れる控えの成否)', () => {
  it('saved は一時ディレクトリ・項目を渡さずに saved だけ', () => {
    expect(toAgentRevertUndoOutcome({ kind: 'saved', dir: '/tmp/undo', items: [] })).toEqual({
      kind: 'saved'
    })
  })

  it('unavailable は理由をそのまま渡す', () => {
    expect(toAgentRevertUndoOutcome({ kind: 'unavailable', reason: 'directory' })).toEqual({
      kind: 'unavailable',
      reason: 'directory'
    })
  })
})

describe('undoPrecheckRejection(全件の照合の結果の判定)', () => {
  const none = { mismatched: [], unreadable: [], savedMissing: [] }

  it('何も無ければ拒否しない', () => {
    expect(undoPrecheckRejection(none)).toBeNull()
  })

  it('不一致が最優先で、控えを捨てる', () => {
    expect(
      undoPrecheckRejection({
        mismatched: ['a.txt'],
        unreadable: [{ path: 'b.txt', reason: 'EACCES' }],
        savedMissing: ['c.txt']
      })
    ).toEqual({
      kind: 'rejected',
      keepUndo: false,
      message: `${AGENT_UNDO_CHANGED_MESSAGE}（a.txt）`
    })
  })

  it('控えのファイルが無ければ、読み込みの失敗より先に拒否して控えを捨てる', () => {
    expect(
      undoPrecheckRejection({
        ...none,
        unreadable: [{ path: 'b.txt', reason: 'EACCES' }],
        savedMissing: ['c.txt']
      })
    ).toEqual({
      kind: 'rejected',
      keepUndo: false,
      message: `${AGENT_UNDO_SAVED_MISSING_MESSAGE}（c.txt）`
    })
  })

  it('読み込みの失敗だけなら控えを残し、最初の理由を添える', () => {
    expect(
      undoPrecheckRejection({
        ...none,
        unreadable: [
          { path: 'b.txt', reason: 'EACCES' },
          { path: 'd.txt', reason: 'EIO' }
        ]
      })
    ).toEqual({
      kind: 'rejected',
      keepUndo: true,
      message: '取り消しの対象を読み込めませんでした（b.txt、d.txt）: EACCES'
    })
  })
})

describe('undoStoppedExecution(書き換えの途中で止まったときの結果)', () => {
  it('1 件も済んでいなければ failed で、0 件のときの文言', () => {
    expect(
      undoStoppedExecution({ restoredPaths: [], trashedPaths: [], total: 2 }, '詳細', '0 件の文言')
    ).toEqual({ kind: 'failed', message: '0 件の文言' })
  })

  it('1 件以上済んでいれば partial で、済んだ件数と詳細', () => {
    expect(
      undoStoppedExecution(
        { restoredPaths: ['a.txt'], trashedPaths: ['b.txt'], total: 3 },
        'c.txt: EIO',
        '0 件の文言'
      )
    ).toEqual({
      kind: 'partial',
      message: '取り消しが途中で失敗しました（2 / 3 件を取り消し済み）: c.txt: EIO',
      restoredPaths: ['a.txt'],
      trashedPaths: ['b.txt']
    })
  })
})

describe('undoStopExecution(止めた理由から止まったときの結果)', () => {
  const NONE_DONE: AgentChangesUndoProgress = { restoredPaths: [], trashedPaths: [], total: 2 }
  const ONE_DONE: AgentChangesUndoProgress = {
    restoredPaths: ['a.txt'],
    trashedPaths: [],
    total: 2
  }

  it.each<[string, AgentChangesUndoStop, string, string]>([
    [
      '書く直前の照合が合わない',
      { kind: 'changed', path: 'b.txt' },
      `${AGENT_UNDO_CHANGED_MESSAGE}（b.txt）`,
      'b.txt が戻した後に変わりました'
    ],
    [
      '書く直前に読み込めない',
      { kind: 'unreadable', path: 'b.txt', reason: 'EACCES' },
      '取り消しに失敗しました: b.txt を読み込めませんでした: EACCES',
      'b.txt を読み込めませんでした: EACCES'
    ],
    [
      '書き換えの失敗',
      { kind: 'write-failed', path: 'b.txt', reason: 'EIO' },
      '取り消しに失敗しました: b.txt: EIO',
      'b.txt: EIO'
    ]
  ])('%s: 0 件なら failed の文言、1 件以上なら partial に詳細を添える', (_, stop, zero, detail) => {
    expect(undoStopExecution(NONE_DONE, stop)).toEqual({ kind: 'failed', message: zero })
    expect(undoStopExecution(ONE_DONE, stop)).toEqual({
      kind: 'partial',
      message: `取り消しが途中で失敗しました（1 / 2 件を取り消し済み）: ${detail}`,
      restoredPaths: ['a.txt'],
      trashedPaths: []
    })
  })
})

describe('undoPrepareFailedMessage(控えの準備に失敗したときの文言)', () => {
  it('中止の文言の後ろに対象のパスを添える', () => {
    expect(undoPrepareFailedMessage('dir/a.txt')).toBe(
      `${AGENT_UNDO_PREPARE_FAILED_MESSAGE}: dir/a.txt`
    )
    expect(undoPrepareFailedMessage('a.txt')).toBe(
      '取り消しの準備に失敗したため、戻すのを中止しました: a.txt'
    )
  })
})

describe('toAgentChangesUndoResult', () => {
  it('done・partial を renderer の結果にする(控えは捨てたので undoSummary は null)', () => {
    expect(
      toAgentChangesUndoResult({ kind: 'done', restoredPaths: ['a.txt'], trashedPaths: ['b.txt'] })
    ).toEqual({
      status: 'done',
      restoredPaths: ['a.txt'],
      trashedPaths: ['b.txt'],
      undoSummary: null
    })
    expect(
      toAgentChangesUndoResult({
        kind: 'partial',
        message: '途中で失敗',
        restoredPaths: ['a.txt'],
        trashedPaths: []
      })
    ).toEqual({
      status: 'partial',
      message: '途中で失敗',
      restoredPaths: ['a.txt'],
      trashedPaths: [],
      undoSummary: null
    })
  })
})
