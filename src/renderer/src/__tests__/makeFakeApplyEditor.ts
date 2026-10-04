import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { IRange } from 'monaco-editor'
import type { ApplySelection, ApplyTargetEditor } from '../lib/applyToEditor'
import type { TrackedEditor } from '../hooks/useTrackedEditorSelection'
import {
  collapsedSelection,
  selectionFromCursorState,
  selectionOf
} from './__mocks__/fakeTextBuffer'

// 選択範囲の作り方は fakeTextBuffer が持つ。反映のテストはここから import できるように再 export する
export { collapsedSelection, selectionOf }

// 反映(applyToEditor・useTrackedEditorSelection・useApplyOutputToEditor)のテストが共有する、選択範囲と偽のエディタの作り方。
// モックは契約の型で vi.fn を作るため、インターフェースから外れると型検査で検出される(パターン 78)

/** その位置の空の範囲(編集の範囲と比べる用。カーソルの位置を持たない) */
export const collapsedRange = (lineNumber: number, column: number): IRange => ({
  startLineNumber: lineNumber,
  startColumn: column,
  endLineNumber: lineNumber,
  endColumn: column
})

export type FakeApplyEditor = { [K in keyof ApplyTargetEditor]: Mock<ApplyTargetEditor[K]> }

export interface FakeApplyEditorOptions {
  /** 既定は (1,1) の空の選択 */
  selection?: ApplySelection | null
  /** 既定はモデルあり。null は破棄済みのインスタンス */
  model?: object | null
  /** executeEdits の戻り値。false は Monaco が編集を拒否した(読み取り専用など) */
  executeResult?: boolean
  /**
   * executeEdits が endCursorState へ逆向きの編集の範囲として渡す、挿入したテキストの範囲。endCursorState が
   * 返した選択の先頭は、Monaco と同じく編集の後の選択になる
   */
  insertedRange?: IRange
}

// 偽のエディタの、テストから書き換えられる状態
interface FakeEditorState {
  selection: ApplySelection | null
  model: object | null
}

function buildApplyEditor(
  state: FakeEditorState,
  options: FakeApplyEditorOptions,
  calls: string[]
): FakeApplyEditor {
  const insertedRange: IRange = options.insertedRange ?? {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 2,
    endColumn: 4
  }
  return {
    getModel: vi.fn<ApplyTargetEditor['getModel']>(() => state.model),
    getSelection: vi.fn<ApplyTargetEditor['getSelection']>(() => state.selection),
    pushUndoStop: vi.fn<ApplyTargetEditor['pushUndoStop']>(() => {
      calls.push('pushUndoStop')
      return true
    }),
    executeEdits: vi.fn<ApplyTargetEditor['executeEdits']>((_source, _edits, endCursorState) => {
      calls.push('executeEdits')
      if (options.executeResult === false) return false
      // Monaco と同じく、コールバックなら戻り値を、配列ならそのまま、編集の後の選択にする(先頭が主カーソル)
      const endSelections =
        typeof endCursorState === 'function'
          ? endCursorState([{ range: insertedRange }])
          : endCursorState
      const endSelection = endSelections?.[0]
      if (endSelection !== undefined) state.selection = selectionFromCursorState(endSelection)
      return true
    }),
    revealPosition: vi.fn<ApplyTargetEditor['revealPosition']>(() => {
      calls.push('revealPosition')
    }),
    focus: vi.fn<ApplyTargetEditor['focus']>(() => {
      calls.push('focus')
    })
  }
}

const initialState = (options: FakeApplyEditorOptions): FakeEditorState => ({
  selection: options.selection === undefined ? collapsedSelection(1, 1) : options.selection,
  model: options.model === undefined ? {} : options.model
})

/**
 * applyToEditor の反映先になる偽のエディタ。編集系の呼び出しの順序を calls に記録する。executeEdits は、
 * endCursorState に insertedRange を逆向きの編集の範囲として渡し、返された選択を編集の後の選択にする(Monaco と同じ形)
 */
export function makeFakeApplyEditor(options: FakeApplyEditorOptions = {}): {
  editor: FakeApplyEditor
  calls: string[]
} {
  const calls: string[] = []
  return { editor: buildApplyEditor(initialState(options), options, calls), calls }
}

export type FakeTrackedEditor = { [K in keyof TrackedEditor]: Mock<TrackedEditor[K]> }

export interface FakeTrackedEditorHandle {
  editor: FakeTrackedEditor
  calls: string[]
  /** 利用者がエディタで範囲を選んだ代わり。選択範囲を変え、選択の購読者へ通知する */
  select: (next: ApplySelection) => void
  /** エディタの破棄(ファイルの切り替え・diff タブ・ファイルを閉じる)の代わり。モデルを失い、破棄の購読者へ通知する */
  dispose: () => void
  /** 購読の数(解除を確かめる) */
  listenerCount: () => number
}

/** 反映先として追う偽のエディタ。makeFakeApplyEditor に、選択の変更・破棄の購読を足したもの */
export function makeFakeTrackedEditor(
  options: FakeApplyEditorOptions = {}
): FakeTrackedEditorHandle {
  const state = initialState(options)
  const calls: string[] = []
  const selectionListeners = new Set<(event: { selection: ApplySelection }) => void>()
  const disposeListeners = new Set<() => void>()
  const editor: FakeTrackedEditor = {
    ...buildApplyEditor(state, options, calls),
    onDidChangeCursorSelection: vi.fn<TrackedEditor['onDidChangeCursorSelection']>((listener) => {
      selectionListeners.add(listener)
      return { dispose: () => selectionListeners.delete(listener) }
    }),
    onDidDispose: vi.fn<TrackedEditor['onDidDispose']>((listener) => {
      disposeListeners.add(listener)
      return { dispose: () => disposeListeners.delete(listener) }
    })
  }
  return {
    editor,
    calls,
    select(next) {
      state.selection = next
      for (const listener of selectionListeners) listener({ selection: next })
    },
    dispose() {
      state.model = null
      for (const listener of [...disposeListeners]) listener()
    },
    listenerCount: () => selectionListeners.size + disposeListeners.size
  }
}
