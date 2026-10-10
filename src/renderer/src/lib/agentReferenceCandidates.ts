import type { AgentAddedReference, AgentReferenceChipState, OpenFile } from '../types'
import {
  buildAgentReferenceList,
  formatAgentReference,
  formatLineSpan,
  toWorkspaceRelativePath
} from './agentReferences'
import type { AgentReference, EditorLineSelection } from './agentReferences'
import { AGENT_REFERENCE_DISABLED_REASONS } from './agentReferenceMessages'
import { isSamePath, toComparablePath } from './pathUtils'

// エージェントへ送るプロンプトの参照の候補(チップを押せるか・何を指すか・未保存か)の解決と、実行のときの写しの組み立て
// (設計書「プロンプトパネルのチップ」「エクスプローラ」)。状態は持たない純粋な関数だけを置き、状態は useAgentReferences が持つ
// (足したファイルの一覧の操作は agentAddedReferencePaths)。
// 候補の解決は文言に依存せず理由の種類だけを返し、文言はチップの表示の状態を組み立てる toAgentReferenceChip だけが引く。
// 表示の状態(パネルへ渡す型)への写像も、チップ(toAgentReferenceChip)と足したファイル(toAgentAddedReference)をここに揃える

/** 実行を押した時点の参照の写し */
export interface PreparedAgentReferences {
  /** 本文へ足す参照(並び・重複のまとめの後) */
  references: AgentReference[]
  /** オンにしたチップ・エクスプローラから足したファイルのうち、未保存の変更があるもの(表示用の相対パス。同じファイルは 1 回) */
  unsavedPaths: string[]
  /** この写しに入れた、エクスプローラから足したファイル(絶対パス。送れたときに外す) */
  addedPaths: string[]
}

export const EMPTY_PREPARED_AGENT_REFERENCES: PreparedAgentReferences = {
  references: [],
  unsavedPaths: [],
  addedPaths: []
}

/** チップを押せない理由の種類(文言は AGENT_REFERENCE_DISABLED_REASONS。チップの状態を組み立てるときに引く) */
export type AgentReferenceUnavailableReason =
  | 'noOpenFile'
  | 'diffTab'
  | 'outsideFolder'
  | 'noSelection'

/**
 * 1 つのチップの候補。押せるなら参照・未保存か・同じファイルかを比べるキー(絶対パスの toComparablePath)、押せないなら理由の種類
 */
export type AgentReferenceCandidate =
  | { kind: 'available'; reference: AgentReference; unsaved: boolean; key: string }
  | { kind: 'unavailable'; reason: AgentReferenceUnavailableReason }

/** エクスプローラから足したファイルの、絶対パスと参照と未保存か */
export interface ResolvedAddedReference {
  absolutePath: string
  reference: AgentReference
  /** そのファイルのタブに未保存の変更があるか(タブが無ければ false) */
  unsaved: boolean
}

// 未保存の判定は、既存のタブの未保存の印と同じ規則(content と保存した内容の比較)
const isUnsaved = (file: OpenFile): boolean => file.content !== file.savedContent

// そのパスのタブに未保存の変更があるか。タブのパスとの比較は isSamePath(Windows の大文字小文字・区切りの違いを吸収する)
const hasUnsavedTab = (openFiles: readonly OpenFile[], path: string): boolean => {
  const file = openFiles.find((f) => isSamePath(f.path, path))
  return file !== undefined && isUnsaved(file)
}

/** 開いているファイルのチップの候補 */
export function resolveOpenFileCandidate(
  folderPath: string,
  activeFile: OpenFile | null,
  isDiffTabActive: boolean
): AgentReferenceCandidate {
  if (isDiffTabActive) return { kind: 'unavailable', reason: 'diffTab' }
  if (activeFile === null) {
    return { kind: 'unavailable', reason: 'noOpenFile' }
  }
  const path = toWorkspaceRelativePath(folderPath, activeFile.path)
  if (path === null) {
    return { kind: 'unavailable', reason: 'outsideFolder' }
  }
  return {
    kind: 'available',
    reference: { path, lineRange: null },
    unsaved: isUnsaved(activeFile),
    key: toComparablePath(activeFile.path)
  }
}

/**
 * 選択範囲のチップの候補。差分のタブでは(エディタが破棄され、差分の表示で範囲を選んでも添えられないため)開いているファイルの
 * チップと同じ diffTab の理由にする
 */
export function resolveSelectionCandidate(
  folderPath: string,
  selection: EditorLineSelection | null,
  isDiffTabActive: boolean,
  openFiles: readonly OpenFile[]
): AgentReferenceCandidate {
  if (isDiffTabActive) return { kind: 'unavailable', reason: 'diffTab' }
  if (selection === null) {
    return { kind: 'unavailable', reason: 'noSelection' }
  }
  const path = toWorkspaceRelativePath(folderPath, selection.filePath)
  if (path === null) {
    return { kind: 'unavailable', reason: 'outsideFolder' }
  }
  // 未保存かは、選択のファイル(マウントの時点のパス)のタブの内容で判定する
  return {
    kind: 'available',
    reference: { path, lineRange: formatLineSpan(selection) },
    unsaved: hasUnsavedTab(openFiles, selection.filePath),
    key: toComparablePath(selection.filePath)
  }
}

/**
 * エクスプローラから足したファイルの参照。削除・改名されてもそのまま残す(既知の制約)。フォルダの外になったもの(起きない想定)は出さない。
 * 未保存かは、そのファイルのタブの内容で判定する(どの入口から添えても同じく知らせる)
 */
export const resolveAddedReferences = (
  folderPath: string,
  addedPaths: readonly string[],
  openFiles: readonly OpenFile[]
): ResolvedAddedReference[] =>
  addedPaths.flatMap((absolutePath) => {
    const path = toWorkspaceRelativePath(folderPath, absolutePath)
    return path === null
      ? []
      : [
          {
            absolutePath,
            reference: { path, lineRange: null },
            unsaved: hasUnsavedTab(openFiles, absolutePath)
          }
        ]
  })

/** 候補とオン・オフから、チップの表示の状態を組み立てる */
export const toAgentReferenceChip = (
  candidate: AgentReferenceCandidate,
  pressed: boolean,
  onToggle: () => void
): AgentReferenceChipState =>
  candidate.kind === 'available'
    ? {
        label: formatAgentReference(candidate.reference),
        disabledReason: null,
        pressed,
        // 印はオンにしたときだけ(送る参照のファイルが claude に見えない内容かを知らせる)
        unsaved: pressed && candidate.unsaved,
        onToggle
      }
    : {
        label: null,
        disabledReason: AGENT_REFERENCE_DISABLED_REASONS[candidate.reason],
        pressed,
        unsaved: false,
        onToggle
      }

/** エクスプローラから足したファイルの、チップの表示の状態(外すときの識別子は絶対パス、出すのは参照。足したファイルは常に送るので印は未保存ならいつも付ける) */
export const toAgentAddedReference = (item: ResolvedAddedReference): AgentAddedReference => ({
  path: item.absolutePath,
  label: formatAgentReference(item.reference),
  unsaved: item.unsaved
})

export interface BuildPreparedInput {
  openFile: AgentReferenceCandidate
  includeOpenFile: boolean
  selection: AgentReferenceCandidate
  includeSelection: boolean
  added: readonly ResolvedAddedReference[]
}

/** 候補とオン・オフから、実行のときの写し(本文へ足す参照・未保存の一覧・写しに入れた足したファイル)を組み立てる */
export function buildPreparedAgentReferences({
  openFile,
  includeOpenFile,
  selection,
  includeSelection,
  added
}: BuildPreparedInput): PreparedAgentReferences {
  const openFileRef = includeOpenFile && openFile.kind === 'available' ? openFile : null
  const selectionRef = includeSelection && selection.kind === 'available' ? selection : null
  // 同じファイルかは、相対パスの文字列ではなく絶対パスから作ったキーで比べる(Windows の大文字小文字・区切りの違い)
  const addedSources = added.map((item) => ({
    path: item.reference.path,
    key: toComparablePath(item.absolutePath),
    unsaved: item.unsaved
  }))
  const references = buildAgentReferenceList({
    openFile:
      openFileRef === null ? null : { path: openFileRef.reference.path, key: openFileRef.key },
    selection: selectionRef === null ? null : { ...selectionRef.reference, key: selectionRef.key },
    added: addedSources
  })
  // 未保存の一覧は、同じファイル(キーが同じ)を 1 回にまとめ、先に出た表記を使う
  const unsavedSources = [
    ...[openFileRef, selectionRef].flatMap((ref) =>
      ref === null ? [] : [{ path: ref.reference.path, key: ref.key, unsaved: ref.unsaved }]
    ),
    ...addedSources
  ]
  const unsavedPaths: string[] = []
  const unsavedKeys = new Set<string>()
  for (const source of unsavedSources) {
    if (!source.unsaved || unsavedKeys.has(source.key)) continue
    unsavedKeys.add(source.key)
    unsavedPaths.push(source.path)
  }
  return { references, unsavedPaths, addedPaths: added.map((item) => item.absolutePath) }
}
