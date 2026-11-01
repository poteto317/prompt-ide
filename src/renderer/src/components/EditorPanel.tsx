import Editor from '@monaco-editor/react'
import type { SelectionRangeEditor } from '../hooks/useEditorSelectionRange'
import type { OpenedFileSignal } from '../hooks/useFileSystem'
import { editorOptions } from '../lib/editorOptions'
import { registerSaveCommand } from '../lib/editorShortcuts'
import { useLatestRef } from '../hooks/useLatestRef'
import { useEditorFocusManager } from '../hooks/useEditorFocusManager'
import { useApplyOutputToEditor } from '../hooks/useApplyOutputToEditor'
import type { AgentChangesReviewAction, AgentDiffActions, OpenFile } from '../types'
import WelcomeView from './editor/WelcomeView'
import EditorTabs from './editor/EditorTabs'
import OutputPanel from './output/OutputPanel'
import type { DiffTabKey } from '../hooks/useDiffTabs'
import { useCombinedEditorTabs } from '../hooks/useCombinedEditorTabs'
import DiffView from './source-control/DiffView'
import { AgentDiffAnnouncer } from './source-control/AgentHunkRevertAction'
import { useAgentDiffFocusRestore } from '../hooks/useAgentDiffFocusRestore'
import ConflictResolver from './source-control/ConflictResolver'
import type { ConflictFileState } from '../hooks/useConflictFile'
import AgentTerminalPanel from './agent/AgentTerminalPanel'
import type { AgentTerminalPanelState } from '../hooks/useAgentWorkspace'
import type { AgentTerminalSize } from './agent/AgentTerminalPanel'
import ExternalChangeBanner, { ExternalChangeAnnouncer } from './editor/ExternalChangeBanner'
import type { ExternalChangeBannerState } from '../hooks/useExternalFileChanges'

interface Props {
  openFiles: OpenFile[]
  activeFilePath: string | null
  isDirty: boolean
  isSaving: boolean
  saveError: Error | null
  onChangeContent: (content: string) => void
  onSave: () => void
  /** 実ファイルタブへ切り替える。戻り値は実際に切り替わったか
   *  (useCombinedEditorTabs が diff タブの非アクティブ化を判断するために見る) */
  onActivateTab: (path: string) => boolean
  onCloseTab: (path: string) => void
  onReorderTabs: (fromIndex: number, toIndex: number) => void
  isExecuting: boolean
  result: string | null
  streamingText: string
  executionError: Error | null
  onClearResult: () => void
  onCancelExecution: () => void
  /** フォーカスを持つモーダル(クイックオープン等)が開いているか */
  isOverlayOpen: boolean
  /** ファイルを開くたびに進む信号。リネームによる path 変更と区別するために使う */
  openedFileSignal: OpenedFileSignal
  diffTabs: DiffTabKey[]
  activeDiffTab: DiffTabKey | null
  onActivateDiffTab: (key: DiffTabKey) => void
  onCloseDiffTab: (key: DiffTabKey) => void
  /** 実ファイルタブがアクティブ化されるとき、diff タブを非アクティブ化するために呼ぶ */
  onDeactivateDiffTab: () => void
  diffContent: string | null
  diffStaged: boolean
  diffError: Error | null
  /** ハンク操作の実行中か。true の間は DiffView のボタンを無効化する */
  isHunkOperationInProgress: boolean
  onStageHunk: (patch: string) => void
  onUnstageHunk: (patch: string) => void
  /** ハンクの取り消し(確認・実行は useDiscardHunk)。DiffView に渡す */
  onDiscardHunk: (patch: string, hunkHeader: string) => void
  /** 開いている diff が取り消せるハンク操作の対象か(DiffView の取り消しボタンの表示条件) */
  canDiscardHunk: boolean
  /** 開いている diff タブが未追跡ファイルか。DiffView に渡し、表示打ち切り時の
   *  ハンク操作ボタン抑止を無効化する(未追跡ファイルの stageHunk は patch を
   *  使わずファイル全体を git add するだけのため) */
  isActiveFileUntracked: boolean
  /** アクティブな diff タブのファイルが未解決のコンフリクト中か。真のとき DiffView の代わりに
   *  解決ビューを表示する(判定は useAppState。EditorPanel 自身は状態を持たない) */
  isActiveFileConflicted: boolean
  /** 解決ビューの状態と操作(useConflictFile) */
  conflictFile: ConflictFileState
  /** 他の操作中(ロック中)か。解決ビューの全ボタンを無効化する(ハンク操作の isHunkOperationInProgress と同じ扱い) */
  isConflictBlocked: boolean
  /** 現在のファイルのエディタがマウントされたときに呼ぶ(useAppState の attachEditorSelection。エージェントへ送るプロンプトの参照の
   *  「選択範囲」を追う)。filePath はマウントの時点の openFile.path(エディタはファイルごとに付け替わる)。省略できない(L-060) */
  onEditorMount: (editor: SelectionRangeEditor, filePath: string) => void
  /**
   * 下部に置くパネル。output: 出力パネル(従来の方式)、agent-terminal: ターミナルパネル(エージェント CLI 方式)、
   * none: 何も置かない(実行方式の読み込み中)。省略時は output
   */
  bottomPanel?: 'output' | 'agent-terminal' | 'none'
  /** bottomPanel が agent-terminal のときのターミナルパネルの状態 */
  agentTerminal?: AgentTerminalPanelState
  /** ターミナルパネルの高さの変更(境界の操作)。無ければ境界を出さない */
  terminalSize?: AgentTerminalSize
  /** 編集中のタブのファイルがディスク上で変わったときの通知(useExternalFileChanges)。無ければ null */
  externalChangeBanner?: ExternalChangeBannerState | null
  /** エージェントの変更の diff タブのハンクの操作(アクティブな diff タブが agent のときだけ DiffView に渡す) */
  agentDiffActions?: AgentDiffActions
  /** ターミナルの帯の「変更を確認」 */
  agentChangesReview?: AgentChangesReviewAction
}

export default function EditorPanel({
  openFiles,
  activeFilePath,
  isDirty,
  isSaving,
  saveError,
  onChangeContent,
  onSave,
  onActivateTab,
  onCloseTab,
  onReorderTabs,
  isExecuting,
  result,
  streamingText,
  executionError,
  onClearResult,
  onCancelExecution,
  isOverlayOpen,
  openedFileSignal,
  diffTabs,
  activeDiffTab,
  onActivateDiffTab,
  onCloseDiffTab,
  onDeactivateDiffTab,
  diffContent,
  diffStaged,
  diffError,
  isHunkOperationInProgress,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk,
  canDiscardHunk,
  isActiveFileUntracked,
  isActiveFileConflicted,
  conflictFile,
  isConflictBlocked,
  onEditorMount,
  bottomPanel = 'output',
  agentTerminal,
  terminalSize,
  externalChangeBanner = null,
  agentDiffActions,
  agentChangesReview
}: Props): React.JSX.Element {
  const openFile = openFiles.find((f) => f.path === activeFilePath) ?? null
  // Monaco の onMount はファイル切替時の再マウント以外では再発火しないため、
  // Ctrl/Cmd+S が常に最新の onSave を呼べるよう ref 経由で参照する。
  const onSaveRef = useLatestRef(onSave)
  const openFilePath = openFile?.path ?? null
  const { handleEditorMount, focusEditorIfPending } = useEditorFocusManager({
    openFilePath,
    openedFileSignal,
    isOverlayOpen
  })
  // 出力パネルからの反映先は、現在のファイルのエディタ(onMount で渡す)。diff タブ・Welcome・ファイルを
  // 閉じたときはエディタが破棄され、反映先から外れる
  const { applyOutput, attachEditor } = useApplyOutputToEditor({ isExecuting })

  const { combinedTabs, activeTabPath, handleActivateTab, handleCloseTab } = useCombinedEditorTabs({
    openFiles,
    activeFilePath,
    isDirty,
    diffTabs,
    activeDiffTab,
    agentDiffRunNumber: agentDiffActions?.contentRunNumber ?? null,
    onActivateTab,
    onCloseTab,
    onActivateDiffTab,
    onCloseDiffTab,
    onDeactivateDiffTab
  })

  const showAgentTerminal = bottomPanel === 'agent-terminal' && agentTerminal !== undefined
  // ターミナルパネルの最大化の間は、タブと本文を隠してパネルが全体を使う(Monaco は automaticLayout で戻したときに合わせ直す)
  const isAgentMaximized = showAgentTerminal && agentTerminal.layout.isMaximized
  // ハンクを戻すと押したボタンが消える(最後のハンクならタブも閉じる)。フォーカスをアクティブなタブへ戻す予約を立てる
  const { panelRef, reserveFocusRestore } = useAgentDiffFocusRestore()
  const agentActionsForDiff: AgentDiffActions | undefined =
    agentDiffActions === undefined
      ? undefined
      : {
          ...agentDiffActions,
          onRevertHunk: (patch, hunkHeader) => {
            reserveFocusRestore()
            agentDiffActions.onRevertHunk(patch, hunkHeader)
          }
        }

  return (
    <div className="editor-panel" ref={panelRef}>
      {/* 外部変更の通知の読み上げ。通知が無い間も置き(文言は同じ要素に入れる)、ターミナルの最大化で隠れるタブと本文の外に置く */}
      <ExternalChangeAnnouncer banner={externalChangeBanner} />
      {/* ハンクを戻した結果の読み上げ。diff の作り直し・タブを閉じても消えないよう、タブと本文の外に常設する */}
      <AgentDiffAnnouncer notice={agentDiffActions?.notice ?? null} />
      <div className="editor-panel__main" hidden={isAgentMaximized}>
        {/* diffTabs に非アクティブな diff タブが残っている場合、WelcomeView に
          切り替えるとタブバーごと消えてそれらのタブへ二度とアクセスできなくなる */}
        {openFile === null && activeDiffTab === null && diffTabs.length === 0 ? (
          <WelcomeView />
        ) : (
          <>
            <EditorTabs
              tabs={combinedTabs}
              activePath={activeTabPath}
              saveTargetPath={activeFilePath}
              isSaving={isSaving}
              saveError={saveError}
              onSave={onSave}
              onActivateTab={handleActivateTab}
              onCloseTab={handleCloseTab}
              onReorderTabs={onReorderTabs}
            />
            <ExternalChangeBanner banner={externalChangeBanner} />
            {/* 既知の挙動: diff タブをアクティブにすると下の <Editor> がアンマウントされ、
              Monaco のモデルが破棄されるため、実ファイルタブへ戻したときに undo/redo
              スタック・カーソル位置・スクロール位置が失われる(バッファの内容自体は
              openFile.content に保持されるので失われない)。常時マウントして
              display:none で切り替える方法はあるが、Monaco は非表示状態だと
              レイアウト計算が狂うため復帰時の layout() 呼び出しが必要になり、
              jsdom ベースのテストでは検証できない副作用を抱え込むことになる */}
            <div className="editor-body">
              {activeDiffTab !== null && isActiveFileConflicted ? (
                // 未解決の間は結合 diff ではなく解決ビュー(内容は main から読み直す。diff の取得は待たない)
                <ConflictResolver conflict={conflictFile} isBlocked={isConflictBlocked} />
              ) : activeDiffTab !== null ? (
                <>
                  {diffError !== null && <p className="diff-view__error">{diffError.message}</p>}
                  {diffContent === null && diffError === null && (
                    <p className="diff-view__loading">読み込み中...</p>
                  )}
                  {diffContent !== null && (
                    <DiffView
                      diffText={diffContent}
                      staged={diffStaged}
                      onStageHunk={onStageHunk}
                      onUnstageHunk={onUnstageHunk}
                      disabled={isHunkOperationInProgress}
                      // agent のタブでは false(useDiffOperations が判定する)
                      isUntracked={isActiveFileUntracked}
                      onDiscardHunk={onDiscardHunk}
                      canDiscardHunk={canDiscardHunk}
                      agentActions={
                        activeDiffTab.kind === 'agent' ? agentActionsForDiff : undefined
                      }
                    />
                  )}
                </>
              ) : openFile !== null ? (
                <Editor
                  key={openFile.path}
                  height="100%"
                  language={openFile.language}
                  theme="vs-dark"
                  value={openFile.content}
                  options={editorOptions}
                  onChange={(value) => onChangeContent(value ?? '')}
                  onMount={(editorInstance, monaco) => {
                    const isCurrent = handleEditorMount(editorInstance, openFile.path)
                    if (!isCurrent) return
                    attachEditor(editorInstance)
                    onEditorMount(editorInstance, openFile.path)
                    registerSaveCommand(editorInstance, monaco, () => onSaveRef.current())
                    focusEditorIfPending()
                  }}
                />
              ) : (
                // 非アクティブな diff タブが残っているだけ(実ファイルタブも
                // アクティブな diff タブも無い)場合、ここに来る。タブバーは表示
                // されているので、何も描画しないと本文だけが空白のまま残り、
                // ユーザーがタブを選び直すまで理由が分からない状態になる
                <p className="editor-panel__placeholder">タブを選択してください</p>
              )}
            </div>
          </>
        )}
      </div>
      {bottomPanel === 'output' && (
        <OutputPanel
          isExecuting={isExecuting}
          result={result}
          streamingText={streamingText}
          executionError={executionError}
          onClear={onClearResult}
          onCancel={onCancelExecution}
          applyOutput={applyOutput}
        />
      )}
      {showAgentTerminal && (
        <AgentTerminalPanel
          state={agentTerminal}
          review={agentChangesReview}
          terminalSize={terminalSize}
        />
      )}
    </div>
  )
}
