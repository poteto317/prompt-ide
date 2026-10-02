import type { CreateTagRequest, FileTreeNode, GitStashEntry } from '@shared/types'

export type {
  PromptToolId,
  FileTreeNode,
  Prompt,
  Task,
  Stage,
  StageEvent,
  StageId,
  StageKind,
  StageStatus,
  HistoryEntry,
  HistoryStatus
} from '@shared/types'

export type FileNode = FileTreeNode & { type: 'file' }

export type Panel = 'explorer' | 'source-control' | 'prompts' | 'progress' | 'history' | 'settings'

export type OpenFile = {
  path: string
  name: string
  content: string
  savedContent: string
  language: string
}

// 実行中のブランチ操作の種類(useGitBranchOperations の pendingBranchOperation)。
// フックと表示側(トリガーの文言を決める lib/branchTriggerLabel 等)の双方が使うため、
// フックではなく renderer 共通の型として置く
export type BranchOperationKind = 'checkout' | 'create' | 'delete' | 'merge'

// 退避の操作の種類。pendingStashOperation(useGitStashOperations)と、各行のボタンの表示で使う
export type StashOperationKind = 'push' | 'pop' | 'drop'

// 実行中の退避操作。どの退避に対する操作かを sha で持つ(push は退避がまだ無いので null)。
// 行ごとに「押したボタンだけ」実行中の表示にするため
export type PendingStashOperation = { kind: StashOperationKind; sha: string | null }

// 「退避」セクションが受け取る状態と操作。値が多いため 1 つのオブジェクトにまとめ、
// App → Sidebar → SourceControlPanel → GitRepoView → StashSection へ 1 つの props で渡す
export interface StashPanelState {
  entries: GitStashEntry[]
  pendingOperation: PendingStashOperation | null
  error: Error | null
  onPush: (message: string) => Promise<void>
  onPop: (sha: string) => Promise<void>
  onDrop: (entry: GitStashEntry) => Promise<boolean>
}

// 「変更をすべて取り消す」が受け取る状態と操作
export interface DiscardAllState {
  /** 一括の取り消しが実行中か */
  isDiscarding: boolean
  error: Error | null
  /** 確認 → 取り消し → 成功時のタブ・ツリーの再読込 */
  onDiscardAll: () => Promise<void>
}

// マージ中の状態(バナー)が受け取る状態と操作。App → Sidebar → SourceControlPanel へ 1 つの props で渡す
export interface MergeStatePanelState {
  /** マージ中か(MERGE_HEAD がある) */
  inProgress: boolean
  /** 未解決(コンフリクト中)のファイル数 */
  unresolvedCount: number
  /** 実行中の操作(完了 / 中止)。何も実行していなければ null */
  pendingOperation: 'complete' | 'abort' | null
  error: Error | null
  /** マージを完了できるか(マージ中で未解決が 0 件) */
  canComplete: boolean
  /** 未保存編集の破棄確認 → マージを完了 → 成功時のタブ・ツリーの再読込 */
  onComplete: () => Promise<void>
  /** 中止の確認 → 未保存編集の破棄確認 → マージを中止 → 成功時のタブ・ツリーの再読込 */
  onAbort: () => Promise<void>
}

// タグの作成(履歴セクションの「タグを作成」とダイアログ)が受け取る状態と操作。
// App → Sidebar → SourceControlPanel → GitRepoView → HistorySection へ 1 つの props(gitTag)で渡す
export interface GitTagPanelState {
  /** タグの作成が実行中か(ダイアログの作成ボタンと入力を disabled にする) */
  isCreating: boolean
  /** 作成の失敗(main のエラー)。ダイアログ内に role="alert" で表示する */
  error: Error | null
  /** 現在の HEAD にタグを作る。戻り値は実際に実行され成功したか(ダイアログを閉じるかの判定に使う)。
   *  他の操作中などで実行しなかった場合と失敗した場合は false */
  createTag: (request: CreateTagRequest) => Promise<boolean>
  /** error を消す。ダイアログを開くときに、前回の失敗の表示を持ち越さないために呼ぶ */
  clearError: () => void
}

// リモートの管理(Git 管理外の「リポジトリを初期化」、状態バナーの「リモートを追加」「初回 push」)が受け取る状態と操作。
// 初期化・追加は useGitRemoteSetup、初回 push は useGitRemoteOperations のものを useAppState で合成する。
// App → Sidebar → SourceControlPanel へ 1 つの props(remoteSetup)で渡し、SourceControlPanel が GitRepoView(状態バナー)と
// NotRepositoryView(Git 管理外のときの初期化)に渡す
export interface RemoteSetupPanelState {
  /** 初期化の実行中か(ダイアログの入力とボタンを disabled にする) */
  isInitializing: boolean
  /** 初期化の失敗(main のエラー)。ダイアログ内に role="alert" で表示する */
  initError: Error | null
  /** 空のリポジトリを作る。戻り値は実際に実行され成功したか(ダイアログを閉じるかの判定に使う)。
   *  他の操作中などで実行しなかった場合と失敗した場合は false */
  initRepository: (branch: string) => Promise<boolean>
  /** initError を消す。ダイアログを開くときに、前回の失敗の表示を持ち越さないために呼ぶ */
  clearInitError: () => void
  /** origin の追加の実行中か */
  isAddingOrigin: boolean
  /** 追加の失敗(main のエラー)。ダイアログ内に role="alert" で表示する */
  addOriginError: Error | null
  /** リモート origin を追加する。戻り値は initRepository と同じ */
  addOrigin: (url: string) => Promise<boolean>
  /** addOriginError を消す */
  clearAddOriginError: () => void
  /** 初回 push の実行中か(push と実行中フラグを共有する。どちらの push かの表示に使う) */
  isSettingUpstream: boolean
  /** push(ツールバーの push・初回 push のどちらか)の実行中か */
  isPushing: boolean
  /** pull 中・他の Git 操作のロック中で、push を要求しても no-op になる状態か */
  isPushBlocked: boolean
  /** push / pull / fetch / 初回 push の失敗(パネル上部に表示する)。初回 push 中の案内を出すかの判定に使う */
  remoteOperationError: Error | null
  /** 現在のブランチを origin へ送り upstream を設定する。戻り値は実際に実行され成功したか */
  pushSetUpstream: () => Promise<boolean>
}
