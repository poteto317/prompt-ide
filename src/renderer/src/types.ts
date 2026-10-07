import type {
  CreateTagRequest,
  FileTreeNode,
  GitStashEntry,
  PromptExecutionMode
} from '@shared/types'

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

// リポジトリの clone(エクスプローラーの「リポジトリを clone」とそのダイアログ)が受け取る状態と操作。
// useCloneRepository が作り、App → Sidebar → ExplorerPanel へ 1 つの props(clone)で渡す
export interface CloneRepositoryPanelState {
  /** clone の依頼中(保存先の選択・clone・成功の後のフォルダの読み込みまで)。フォルダの変更と clone を押せなくする */
  isCloning: boolean
  /** clone が cloned で返ってから、そのフォルダを開き終わるまで(applyOpenedFolder を待つ間)だけ true。isCloning も
   *  true のまま(ロックと閉じる禁止は続く)。main に中止する clone がもう無いため、ダイアログは中止の案内と
   *  `キャンセル` を出さない(押せなくする) */
  isOpening: boolean
  /** 他の Git 操作の実行中で、clone を始められない(押しても何もしない)。clone 自身の実行中(全体ロックを含む)は
   *  false(実行中は isCloning が表す) */
  isBlocked: boolean
  /** clone の失敗(main のエラー)。ダイアログ内に role="alert" で表示する */
  error: Error | null
  /** clone し、成功したらそのフォルダを開く。戻り値は開いたか(保存先の選択の取り消し・中止・失敗・未保存の確認の
   *  取り消し・他の操作中で実行しなかった場合は false。ダイアログを閉じるかの判定に使う) */
  cloneRepository: (url: string, folderName: string) => Promise<boolean>
  /** 実行中の clone を中止する(実行中でなければ何もしない) */
  cancelClone: () => void
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

// AI の出力のエディタへの反映(useApplyOutputToEditor)。挿入はカーソルの位置へ、置換は選択範囲を置き換える
export type ApplyMode = 'insert' | 'replace'

// エージェントの変更の diff タブ(DiffView の agentActions)。ハンクを実行前に戻す操作と、押せない理由
export interface AgentDiffActions {
  /** 開いている diff のハンクを戻せるか(変更〈M〉で、記録したファイル。追加・削除・種類の変更はファイル単位で戻す) */
  canRevertHunk: boolean
  /** 押せない理由(押せるなら null。パターン 126) */
  disabledReason: string | null
  /** このタブのパスについての直前の戻す操作の失敗(無ければ null)。読み上げは notice とセクションが行うため、見た目だけに出す */
  error: string | null
  /** ハンクを戻した結果(成功・失敗)の読み上げ。EditorPanel が常設の aria-live に入れる(タブが閉じても届くように) */
  notice: Announcement | null
  /** 確認 → 戻す → 成功したときだけ同期(useAgentChangesRevert) */
  onRevertHunk: (patch: string, hunkHeader: string) => void
}

// ターミナルの見出しの帯の「変更を確認」(エージェントの変更の記録がある間だけ出す。組み立ては useAgentChangesWiring)
export interface AgentChangesReviewAction {
  isRecording: boolean
  /** ソース管理パネルを開き、一覧を取り直し、セクションへフォーカスを移す */
  onReview: () => void
}

// role="status" で読み上げる通知。id は通知ごとに進め、同じ文言が続いても読み上げられるようにする(パターン 87)
export interface Announcement {
  text: string
  id: number
}

// 出力パネル(ヘッダーとコードブロック)が使う、反映の可否と操作
export interface ApplyOutputState {
  /** 挿入できない理由。null なら挿入できる */
  insertDisabledReason: string | null
  /** 置換できない理由。null なら置換できる */
  replaceDisabledReason: string | null
  /** 反映する。無効な操作は何もしない */
  apply: (mode: ApplyMode, text: string) => void
  /** 直近の反映の結果の通知(数秒後に null へ戻る) */
  notice: Announcement | null
}

// エージェント CLI 方式の送信の失敗(role="alert")と成功の通知(role="status")
export interface AgentSendFeedback {
  error: string | null
  notice: Announcement | null
}

// 設定パネルの実行方式の項目の状態と操作(useAgentWorkspace が組み立て、Sidebar → SettingsPanel へ渡す)
export interface ExecutionModePanelState {
  mode: PromptExecutionMode | null
  saveError: string | null
  isLocked: boolean
  /** 選べない理由(従来の方式の実行中)。無ければ null・省略 */
  lockedReason?: string | null
  onSelect: (mode: PromptExecutionMode) => void
}

// プロンプトの実行ボタン・履歴の再実行の押せる条件と、エージェント CLI 方式の送信の結果(lib/promptRunState.ts の
// buildPromptRunPanelState が組み立て〈useAgentWorkspace から呼ぶ〉、Sidebar → PromptsPanel・HistoryPanel へ渡す)
export interface PromptRunPanelState {
  isRunDisabled: boolean
  /** 押せない理由(プロンプトパネルの上部に 1 か所だけ表示し、無効のボタンの aria-describedby から参照する) */
  runDisabledReason: string | null
  /** エージェント CLI 方式の送信の失敗(role="alert")と成功の通知(role="status")。従来の方式では null */
  agentSend: AgentSendFeedback | null
  /** 実行ツールの選択を出すか(従来の方式だけ。C3) */
  showToolSelector: boolean
  /** 実行ボタンの aria-label(可視の文言「実行」で始める。パターン 76) */
  runAriaLabel: string
  isRerunDisabled: boolean
  rerunDisabledReason: string | null
}
