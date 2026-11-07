import type {
  AgentCliKindSetting,
  AgentChangesAttributionSummary,
  AgentChangesList,
  AgentChangesRun,
  AgentChangesScope,
  AgentChangesScopeUnavailableReason,
  AgentChangesState,
  AgentChangesStorage,
  AgentChangesUndoSummary,
  CreateTagRequest,
  FileTreeNode,
  GitStashEntry,
  PromptExecutionMode,
  PromptListMode
} from '@shared/types'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'

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
  HistoryStatus,
  AgentHistoryInfo
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

// stash の操作の種類。pendingStashOperation(useGitStashOperations)と、各行のボタンの表示で使う
export type StashOperationKind = 'push' | 'pop' | 'drop'

// 実行中の stash 操作。どの stash に対する操作かを sha で持つ(push は stash がまだ無いので null)。
// 行ごとに「押したボタンだけ」実行中の表示にするため
export type PendingStashOperation = { kind: StashOperationKind; sha: string | null }

// 「stash」セクションが受け取る状態と操作。値が多いため 1 つのオブジェクトにまとめ、
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

/** 指示ファイルの節の 1 行。node はツリーで見つかったファイル(無ければ null) */
export interface AgentInstructionFileRow {
  file: AgentInstructionFile
  /** 一覧と aria-label に出す相対パス(区切りは /) */
  relativePath: string
  node: FileTreeNode | null
}

/** サブフォルダの指示ファイルの 1 行(設計書 2026-11-07「状態」) */
export interface AgentInstructionSubfolderRow {
  /** 根からの相対パス(区切りは /)。表示と aria-label に使う */
  relativePath: string
  description: string
  node: FileTreeNode
}

/** エクスプローラーの「エージェントの指示ファイル」の節の状態と操作(設計書 2026-11-05) */
export interface AgentInstructionsPanelState {
  /** 一覧の CLI(設定の種類。読み込み中は既定の claude) */
  cliKind: AgentCliKind
  rows: readonly AgentInstructionFileRow[]
  /** 作成の途中(押した結果)。節のボタンを aria-disabled にし、押しても何もしない(disabled にするのは clone 中だけ。L-157) */
  isCreating: boolean
  /** 失敗の固定の文言。次の操作で消える */
  message: string | null
  /** ファイルがある行を開く(エクスプローラーでファイルを選んだときと同じ経路) */
  open: (row: AgentInstructionFileRow) => void
  /** 無い行を雛形で作って開く */
  create: (row: AgentInstructionFileRow) => Promise<void>
  /** サブフォルダの指示ファイル(上限までに切った分。設計書 2026-11-07) */
  subfolderRows: readonly AgentInstructionSubfolderRow[]
  /** 見つかった全件の数(上限で隠した分を含む) */
  subfolderTotal: number
  /** サブフォルダの一覧の上に出す注(無ければ null) */
  subfolderNote: string | null
  /** サブフォルダの行を開く(エクスプローラーでファイルを選んだときと同じ経路) */
  openSubfolderFile: (row: AgentInstructionSubfolderRow) => void
  /** `更新` の途中(押した結果)。`更新` を aria-disabled にする */
  isRefreshing: boolean
  /** ファイルツリーを読み直す(useFileSystem.refreshTree を呼ぶだけ)。拒否しない */
  refresh: () => Promise<void>
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

// エージェントの変更の記録の写し(useAgentChanges が持ち、lib の純粋な関数が読む)
/** 写しの一覧。listed: 範囲の一覧(scope はそれを取った範囲)、scope-unavailable: 範囲の一覧を出せない(写しが古い)理由 */
export type AgentChangesViewList =
  | ({ kind: 'listed'; scope: AgentChangesScope } & AgentChangesList)
  | {
      kind: 'scope-unavailable'
      scope: AgentChangesScope
      reason: AgentChangesScopeUnavailableReason
    }

/** エージェントの変更の書き換えの実行中の印(戻す操作・取り消し。実行の共有〈useAgentChangesWriteRunner〉が持つ) */
export type AgentChangesRunningOperation = 'revert' | 'undo'

export type AgentChangesView =
  | { kind: 'none' }
  | { kind: 'unavailable'; state: Extract<AgentChangesState, { kind: 'unavailable' }> }
  /**
   * runs は main の実行の一覧(古い順)。list は取り直す前・範囲を変えた直後は null。undo は main の取り消しの控えの要約(無ければ null)。
   * attribution は main の記録の区別の要約、storage は main の記録の置き場
   */
  | {
      kind: 'recording'
      startedAt: number
      runs: AgentChangesRun[]
      list: AgentChangesViewList | null
      undo: AgentChangesUndoSummary | null
      attribution: AgentChangesAttributionSummary
      storage: AgentChangesStorage
    }

// エージェントの変更の diff タブ(DiffView の agentActions)。ハンクを実行前に戻す操作と、押せない理由
export interface AgentDiffActions {
  /** 開いている diff のハンクを戻せるか(変更〈M〉で、記録したファイル。追加・削除・種類の変更はファイル単位で戻す) */
  canRevertHunk: boolean
  /** 表示中の diff の内容を取った範囲の実行の番号(タブのラベルの「実行 N」。累積・内容が無い間は null) */
  contentRunNumber: number | null
  /** 押せない理由(押せるなら null。パターン 126) */
  disabledReason: string | null
  /** このタブのパスについての直前の戻す操作の失敗(無ければ null)。読み上げは、ハンクの失敗は notice(diff 側)だけ、ファイルの失敗はセクションの alert が行うため、ここは見た目だけに出す */
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

// エージェント CLI 方式の送信の失敗と成功の通知(読み上げは Sidebar の常設の AgentSendFeedbackAnnouncer の role="alert"・role="status")
export interface AgentSendFeedback {
  error: string | null
  notice: Announcement | null
}

// 設定パネルの実行方式の項目の状態と操作(useAgentWorkspace が組み立て、Sidebar → SettingsPanel へ渡す)
export interface ExecutionModePanelState {
  mode: PromptExecutionMode | null
  saveError: string | null
  /** 押す前から選べない(読み込み中・どれかのタブが起動中・従来の方式の実行中)。選択肢を disabled にする */
  isLocked: boolean
  /** 実行方式か CLI の切り替えの途中(押した結果)。選択肢を aria-disabled にし、押しても選ばない(L-157) */
  isSwitching: boolean
  /** 選べない理由(従来の方式の実行中・実行方式か CLI の切り替えの途中。実行中を優先)。無ければ null・省略 */
  lockedReason?: string | null
  onSelect: (mode: PromptExecutionMode) => void
}

// プロンプト一覧の編集モード / 表示モード(usePromptListMode が組み立て、useAppState → App → Sidebar → PromptsPanel へ渡す)
export interface PromptListModePanelState {
  /** 読み込みが終わるまでは null(トグルを押せず、`編集`・`削除` を出さない) */
  mode: PromptListMode | null
  /** 保存の失敗の文言(固定。トグルの下に出す)。次の保存で消える */
  saveError: string | null
  /** 保存の途中(押した結果)。トグルは aria-disabled にし、押しても onChange は働かない(disabled にしない。L-157) */
  isSaving: boolean
  /** 選んですぐ保存する。保存の途中は何もしない。失敗したら直前の値に戻し、saveError に出す(部品は完了を待たない) */
  onChange: (mode: PromptListMode) => void
}

// 設定パネルの真偽値の設定の節(BooleanSettingSection)へ渡す値と操作(useBooleanSetting の値から組み立てる)
export interface BooleanSettingPanelState {
  /** 読み込み中は null(押せない) */
  enabled: boolean | null
  saveError: string | null
  onChange: (enabled: boolean) => void
}

// エージェントの通知の設定(useAgentWorkspace が組み立て、Sidebar → SettingsPanel へ渡す)
export interface AgentNotificationPanelState extends BooleanSettingPanelState {
  /** 選んだ CLI が完了・許可待ちの通知を出せない(画面を判定しない)ときの注記。出せるなら null(省略できない。L-060) */
  unsupportedNote: string | null
}

// エージェントへの送信前の確認の設定(useAgentWorkspace が組み立て、Sidebar → SettingsPanel へ渡す)
export type AgentSendConfirmPanelState = BooleanSettingPanelState

// 使うエージェント CLI の設定(useAgentWorkspace が組み立て、Sidebar → SettingsPanel → AgentCliKindSection へ渡す)
export interface AgentCliKindPanelState {
  /** 読み込み中は null(選べない) */
  kind: AgentCliKind | null
  /** main が既定に戻した理由(注記に出す)。戻していなければ null */
  fallback: AgentCliKindSetting['fallback']
  saveError: string | null
  /** 押す前から選べない(読み込み中・どれかのタブが起動中)。選択肢を disabled にする */
  isLocked: boolean
  /** 実行方式か CLI の切り替えの途中(押した結果)。選択肢を aria-disabled にし、押しても選ばない(L-157) */
  isSwitching: boolean
  /** 選べない理由(起動中・実行方式か CLI の切り替えの途中。起動中を優先)。表示し、選択肢から参照する。出さないときは null */
  lockedReason: string | null
  /** 選ぶ(動いているタブがあれば確認してから止め、保存する) */
  onSelect: (kind: AgentCliKind) => void
}

// 参照のチップ(開いているファイル・選択範囲)の状態と操作(useAgentReferences が組み立て、Sidebar → PromptsPanel → AgentReferenceChips へ渡す)。
// 押せるか(disabledReason)と表示の参照(label)は必ず対で変わるため、食い違う組み合わせを型で作れないようにする
export type AgentReferenceChipState = {
  /** オンか(押せないときも保つ。タブを切り替えてもオンのまま) */
  pressed: boolean
  onToggle: () => void
} & (
  | {
      /** チップに出す参照(`@src/app.ts`・`@src/app.ts#L10-20`) */
      label: string
      disabledReason: null
      /** オンで、そのファイルに未保存の変更があるか(チップに「未保存」の印を付ける) */
      unsaved: boolean
    }
  | {
      label: null
      /** 押せない理由(title と aria-describedby で出す。押せるかの判定にも使う) */
      disabledReason: string
      unsaved: false
    }
)

/** エクスプローラから足したファイル */
export interface AgentAddedReference {
  /** 絶対パス(外すときの識別子・React の key) */
  path: string
  /** チップに出す参照(`@docs/notes.md`) */
  label: string
  /** そのファイルのタブに未保存の変更があるか(チップに未保存の印を付ける) */
  unsaved: boolean
}

// プロンプトパネルの参照の行の状態と操作(useAgentReferences が組み立てる。エージェント CLI 方式でフォルダを開いているときだけで、
// それ以外は null)。Sidebar がプロンプトパネル(チップ)とエクスプローラ(右クリックの「参照として添える」)へ渡す
export interface AgentReferencesPanelState {
  openFile: AgentReferenceChipState
  selection: AgentReferenceChipState
  /** エクスプローラから足したファイル(足した順) */
  added: AgentAddedReference[]
  /** エクスプローラから足したファイルを外す(絶対パス) */
  onRemove: (path: string) => void
  /** エクスプローラの右クリックの「参照として添える」(絶対パス。すでにあれば一覧は変えず、すでにあることを読み上げる) */
  onAddFromExplorer: (path: string) => void
}

// 送信前の確認のダイアログで開いている依頼(useAgentWorkspace が useAgentSendConfirm の pending から組み立てる)
export interface AgentSendConfirmPending {
  /** 引数から送る全文(正規化の前)を作る。ダイアログが正規化して表示する */
  composeText: (argument: string) => string
  /** 送り先のタブ */
  slotId: string
  /** 送り先のタブの名前(開いた時点で固定) */
  label: string
  /** 送り先のタブの CLI の種類(開いた時点で固定。本文の規則・送れない理由・未保存の注意の CLI の名前に使う) */
  cliKind: AgentCliKind
  /** 開いた元のプロンプトの id(キャンセルで閉じたとき・送信が失敗したときのフォーカスの戻り先) */
  promptId: string | null
  /** 未保存の変更がある、参照として添えたファイル(表示用の相対パス)。実行を押した時点の写しで、開いている間に保存しても変えない */
  unsavedPaths: readonly string[]
}

// 送信前の確認のダイアログの状態と操作(useAgentWorkspace が組み立て、App が描画する。省略できない形で渡す。L-060)
export interface AgentSendConfirmDialogState {
  /** 開いている確認。閉じていれば null */
  pending: AgentSendConfirmPending | null
  /** 送り先のタブが今は送れない理由(終了した・閉じる途中・送信中)。送れるなら null */
  targetBlockedReason: string | null
  /** 控えた送り先へ送って閉じる。フォーカスは送信が終わってから移す(送れたら送り先のタブのターミナル、失敗したら確認を開いた時点の要素〈履歴の詳細の `再実行` など〉、無ければ同じプロンプトの `実行`。送信中に利用者が別の場所へ移していれば移さない) */
  onConfirm: (argument: string) => void
  /** 送らずに閉じる */
  onCancel: () => void
}

// プロンプトの実行ボタンの押せる条件と、エージェント CLI 方式の送信の結果(lib/promptRunState.ts の
// buildPromptRunPanelState が組み立て〈useAgentWorkspace から呼ぶ〉、Sidebar → PromptsPanel へ渡す。送信の結果〈agentSend〉は、Sidebar が
// 見えている側のパネル〈PromptsPanel / HistoryPanel〉の見える文言と、パネルの外に常に置く AgentSendFeedbackAnnouncer の読み上げに渡す。
// 履歴の再実行の押せる条件はエントリごとに HistoryEntryActions)
export interface PromptRunPanelState {
  isRunDisabled: boolean
  /** 押せない理由(プロンプトパネルの上部に 1 か所だけ表示し、無効のボタンの aria-describedby から参照する) */
  runDisabledReason: string | null
  /** エージェント CLI 方式の送信の失敗と成功の通知(読み上げは AgentSendFeedbackAnnouncer の role="alert"・role="status"、見える文言は
   *  見えている側のパネルに aria-hidden で出す)。従来の方式では null */
  agentSend: AgentSendFeedback | null
  /** 実行ツールの選択を出すか(従来の方式だけ。C3) */
  showToolSelector: boolean
  /** 実行ボタンの aria-label(可視の文言「実行」で始める。パターン 76) */
  runAriaLabel: string
}

/** 履歴の操作の押せる条件(押せない理由は詳細に見える文字で出し、ボタンの aria-describedby で結ぶ) */
export interface HistoryActionAvailability {
  disabled: boolean
  reason: string | null
}

/** 履歴のエントリごとの操作の押せる条件(useAgentWorkspace の getHistoryActions。Sidebar → HistoryPanel → HistoryDetail) */
export interface HistoryEntryActions {
  rerun: HistoryActionAvailability
  /** このセッションで再開。従来のエントリ(agent が null)は null(ボタンを出さない) */
  resume: HistoryActionAvailability | null
}
