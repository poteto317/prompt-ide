import { useCallback, useState } from 'react'
import type { AgentReferencesPanelState, Announcement, OpenFile } from '../types'
import { useLatestRef } from './useLatestRef'
import { useOnChange } from './useOnChange'
import { formatAgentReference, toWorkspaceRelativePath } from '../lib/agentReferences'
import type { EditorLineSelection } from '../lib/agentReferences'
import {
  formatAgentReferenceAddedAnnouncement,
  formatAgentReferenceAlreadyAddedAnnouncement
} from '../lib/agentReferenceMessages'
import {
  EMPTY_PREPARED_AGENT_REFERENCES,
  buildPreparedAgentReferences,
  resolveAddedReferences,
  resolveOpenFileCandidate,
  resolveSelectionCandidate,
  toAgentAddedReference,
  toAgentReferenceChip
} from '../lib/agentReferenceCandidates'
import type { PreparedAgentReferences } from '../lib/agentReferenceCandidates'
import {
  appendAddedPath,
  hasAddedPath,
  removeAddedPath,
  removeSentPaths
} from '../lib/agentAddedReferencePaths'

// エージェントへ送るプロンプトに添える参照の状態(設計書「プロンプトパネルのチップ」「エクスプローラ」)。チップのオン・オフ、
// エクスプローラから足したファイルとその読み上げの状態、フォルダ・方式の切り替えと送れたときの後始末を持ち、実行のときに使う参照の写し(prepare)を
// 返す。候補の解決(未保存の判定を含む)・表示の状態への写像・写しの組み立ては lib/agentReferenceCandidates、足したファイルの一覧の
// 操作は lib/agentAddedReferencePaths に置く。useAppState で使い、写しを本文へ足すのは usePromptRunner

export interface UseAgentReferencesOptions {
  /** 開いているフォルダ(claude の作業フォルダと同じ。相対パスの基準) */
  folderPath: string | null
  /** エージェント CLI 方式か(読み込み中は false) */
  isAgentMode: boolean
  /** アクティブな実ファイルのタブ(useFileSystem.openFile。差分のタブの表示中も実ファイルを指す) */
  activeFile: OpenFile | null
  /** 差分のタブを表示しているか(開いているファイル・選択範囲のチップを押せなくする) */
  isDiffTabActive: boolean
  /** 開いているタブ(選択範囲・エクスプローラから足したファイルの未保存の判定に使う) */
  openFiles: readonly OpenFile[]
  /** アクティブなエディタの空でない選択(useEditorSelectionRange) */
  selection: EditorLineSelection | null
}

export interface AgentReferencesState {
  /** プロンプトパネルの参照の行。エージェント CLI 方式でフォルダを開いているときだけで、それ以外は null */
  panel: AgentReferencesPanelState | null
  /** エクスプローラから足したとき・すでに足してあったときの読み上げ(App の常設の aria-live に出す)。まだ無ければ null */
  announcement: Announcement | null
  /** 今の参照の写し(実行を押した時点で呼ぶ)。描画をまたいで同じ参照 */
  prepare: () => PreparedAgentReferences
  /** 送れたときに呼ぶ。写しに入れたエクスプローラのファイルだけを外す(後から足したもの・チップのオンは残す)。描画をまたいで同じ参照 */
  markSent: (prepared: PreparedAgentReferences) => void
}

export function useAgentReferences({
  folderPath,
  isAgentMode,
  activeFile,
  isDiffTabActive,
  openFiles,
  selection
}: UseAgentReferencesOptions): AgentReferencesState {
  const [includeOpenFile, setIncludeOpenFile] = useState(false)
  const [includeSelection, setIncludeSelection] = useState(false)
  const [addedPaths, setAddedPaths] = useState<readonly string[]>([])
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)

  // 元の状態が終わる契機(フォルダの切り替え・従来の方式への切り替え)で、足したファイルを外し、チップをオフに戻す(L-405)
  const reset = (): void => {
    setIncludeOpenFile(false)
    setIncludeSelection(false)
    setAddedPaths([])
  }
  useOnChange(folderPath, reset)
  useOnChange(isAgentMode, () => {
    if (!isAgentMode) reset()
  })

  // 参照を出すのはエージェント CLI 方式でフォルダを開いているときだけ
  const workspace = isAgentMode ? folderPath : null
  const view =
    workspace === null
      ? null
      : {
          openFile: resolveOpenFileCandidate(workspace, activeFile, isDiffTabActive),
          selection: resolveSelectionCandidate(workspace, selection, isDiffTabActive, openFiles),
          added: resolveAddedReferences(workspace, addedPaths, openFiles)
        }
  const prepared =
    view === null
      ? EMPTY_PREPARED_AGENT_REFERENCES
      : buildPreparedAgentReferences({ ...view, includeOpenFile, includeSelection })

  // usePromptRunner の useCallback の依存に入るため、prepare・markSent は同じ参照にし、最新の写しは ref から読む
  const preparedRef = useLatestRef(prepared)
  const prepare = useCallback((): PreparedAgentReferences => preparedRef.current, [preparedRef])
  // 外すのは写しに入れたものだけ(確認を開いている間に足したものは残す。写しは実行を押した時点。L-407)
  const markSent = useCallback((sent: PreparedAgentReferences): void => {
    if (sent.addedPaths.length === 0) return
    setAddedPaths((prev) => removeSentPaths(prev, sent.addedPaths))
  }, [])

  const addFromExplorer = (absolutePath: string): void => {
    if (workspace === null) return
    const path = toWorkspaceRelativePath(workspace, absolutePath)
    if (path === null) return
    const label = formatAgentReference({ path, lineRange: null })
    // すでに足してあるときも、プロンプトパネルが隠れている間に結果が伝わるよう読み上げる
    const alreadyAdded = hasAddedPath(addedPaths, absolutePath)
    if (!alreadyAdded) setAddedPaths((prev) => appendAddedPath(prev, absolutePath))
    // 同じ文言が続いても読み上げ直すよう、id を進める(toAnnouncementText。パターン 87)
    setAnnouncement((prev) => ({
      id: (prev?.id ?? 0) + 1,
      text: alreadyAdded
        ? formatAgentReferenceAlreadyAddedAnnouncement(label)
        : formatAgentReferenceAddedAnnouncement(label)
    }))
  }

  const panel: AgentReferencesPanelState | null =
    view === null
      ? null
      : {
          openFile: toAgentReferenceChip(view.openFile, includeOpenFile, () =>
            setIncludeOpenFile((v) => !v)
          ),
          selection: toAgentReferenceChip(view.selection, includeSelection, () =>
            setIncludeSelection((v) => !v)
          ),
          added: view.added.map(toAgentAddedReference),
          onRemove: (path) => setAddedPaths((prev) => removeAddedPath(prev, path)),
          onAddFromExplorer: addFromExplorer
        }

  return { panel, announcement, prepare, markSent }
}
