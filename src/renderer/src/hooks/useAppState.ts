import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePanelState } from './usePanelState'
import { useFileSystem } from './useFileSystem'
import { usePrompts } from './usePrompts'
import { useProgressTasks } from './useProgressTasks'
import { useGitStatus } from './useGitStatus'
import { useGitOperations } from './useGitOperations'
import { useGitRemoteOperations } from './useGitRemoteOperations'
import { useGitBranchOperations } from './useGitBranchOperations'
import { useDiscardFileChanges } from './useDiscardFileChanges'
import { useDiscardHunk } from './useDiscardHunk'
import { useDiscardAllChanges } from './useDiscardAllChanges'
import { useSettings } from './useSettings'
import { usePromptExecution } from './usePromptExecution'
import { useHistory } from './useHistory'
import { usePromptRunner } from './usePromptRunner'
import { useQuickOpen } from './useQuickOpen'
import { useDiffTabs } from './useDiffTabs'
import { useDiffOperations } from './useDiffOperations'
import { useGitHistory } from './useGitHistory'
import { useStashPanel } from './useStashPanel'
import { useMergeState } from './useMergeState'
import { useConflictFile } from './useConflictFile'
import { useGitTagOperations } from './useGitTagOperations'
import { useGitRemoteSetup } from './useGitRemoteSetup'
import { useCloneRepository } from './useCloneRepository'
import type { ConflictFileState } from './useConflictFile'
import { useFileOperationLock } from './useFileOperationLock'
import { useOnChange } from './useOnChange'
import { runEditorSyncedOperation } from '../lib/editorSyncedOperation'
import { isAnyGitOperationRunning } from '../lib/gitOperationActivity'
import { isSamePath } from '../lib/pathUtils'
import type {
  CloneRepositoryPanelState,
  DiscardAllState,
  GitTagPanelState,
  MergeStatePanelState,
  RemoteSetupPanelState,
  StashPanelState
} from '../types'
import { isConflictedFile, isStagedFile, isUnstagedFile } from '../lib/gitUtils'
import { useAgentWorkspace } from './useAgentWorkspace'
import type { AgentWorkspaceState } from './useAgentWorkspace'
import { useExternalChangeMarks } from './useExternalChangeMarks'
import { useExternalFileChanges } from './useExternalFileChanges'
import type { ExternalChangeBannerState } from './useExternalFileChanges'
import { AGENT_STOP_ON_FOLDER_CHANGE_CONFIRM } from '../lib/agentSessionMessages'
import { useAgentChangesRecording } from './useAgentChangesRecording'
import { useAgentChangesWiring } from './useAgentChangesWiring'
import type { AgentChangesWiring } from './useAgentChangesWiring'

type AppState = {
  quickOpen: ReturnType<typeof useQuickOpen>
  /** 対象ファイルが useGitOperations/useDiffOperations のいずれかで .git/index への
   *  書き込み中かどうか。ChangesSection/StagedSection/DiffView が、自分が知らない
   *  別経路からの操作との競合を検知してボタンを disabled にするために使う */
  isLocked: (path: string) => boolean
  /** いずれかのファイルが isLocked の対象になっているか(ハンク操作が実行中か)。
   *  CommitSection が、ハンク操作(git apply --cached)の実行中に commit ボタンを
   *  disabled にするために使う。runCommitOperation はこの状態を検知すると
   *  サイレントに no-op するため、ボタン側でも揃えないと押しても反応しない
   *  ように見えてしまう */
  isAnyLocked: () => boolean
  /** gitBranchOperations.checkoutBranch(戻り値 Promise<boolean>、成功可否を
   *  useAppState.ts 側の後続処理の分岐に使う)を、破棄確認 + 成功時のみ
   *  reloadOpenFiles を行うラッパーに差し替えている。呼び出し元(UI)にとって
   *  意味があるのは完了を待てることだけなので、公開する型は Promise<void> */
  checkoutBranch: (branchName: string) => Promise<void>
  /** gitBranchOperations.mergeBranch(戻り値 Promise<boolean>)を、未保存編集の破棄確認 +
   *  成功時のみ reloadOpenFiles を行うラッパーに差し替えている(checkoutBranch と同じ)。
   *  公開する型は Promise<void> */
  mergeBranch: (branchName: string) => Promise<void>
  /** 退避セクションが受け取る状態と操作。退避・復元は未保存編集の破棄確認 + 成功時の
   *  ファイルツリーとタブの再読込を行うラッパーに差し替えている */
  stash: StashPanelState
  /** ハンクの取り消し(確認 → 取り消し → 成功時のタブ・ツリーの再読込)。引数は diff のパッチと
   *  ハンクの見出し(確認文言に使う)。useDiffOperations の同名の boolean 版を差し替えている */
  discardHunk: (patch: string, hunkHeader: string) => Promise<void>
  /** 未ステージの変更をすべて取り消す状態と操作(確認・排他・タブとツリーの再読込込み) */
  discardAll: DiscardAllState
  /** タグの作成の状態と操作(履歴セクションの「タグを作成」とダイアログ) */
  gitTag: GitTagPanelState
  /** リモートの管理の状態と操作(Git 管理外の「リポジトリを初期化」、状態バナーの「リモートを追加」「初回 push」) */
  remoteSetup: RemoteSetupPanelState
  /** リポジトリの clone の状態と操作(エクスプローラーの「リポジトリを clone」とダイアログ) */
  clone: CloneRepositoryPanelState
  /** マージ中バナーの状態と、マージの完了・中止の操作 */
  mergeState: MergeStatePanelState
  /** 未解決ファイルの解決ビューの状態と操作 */
  conflictFile: ConflictFileState
  /** アクティブな diff タブのファイルがコンフリクト中か(EditorPanel が解決ビューを出す条件。
   *  conflictFile の対象と同じ導出) */
  isActiveFileConflicted: boolean
  /** 編集中のタブの外部変更の通知 */
  externalChangeBanner: ExternalChangeBannerState | null
} & AgentChangesWiring &
  Omit<AgentWorkspaceState, 'confirmStopAgent' | 'sendToAgent'> &
  ReturnType<typeof usePanelState> &
  ReturnType<typeof useFileSystem> &
  ReturnType<typeof usePrompts> &
  ReturnType<typeof useProgressTasks> &
  ReturnType<typeof useGitStatus> &
  ReturnType<typeof useGitOperations> &
  ReturnType<typeof useGitRemoteOperations> &
  Omit<ReturnType<typeof useGitBranchOperations>, 'checkoutBranch' | 'mergeBranch'> &
  ReturnType<typeof useSettings> &
  ReturnType<typeof usePromptExecution> &
  ReturnType<typeof useHistory> &
  ReturnType<typeof usePromptRunner> &
  ReturnType<typeof useDiffTabs> &
  Omit<ReturnType<typeof useDiffOperations>, 'discardHunk'> &
  ReturnType<typeof useGitHistory>

export function useAppState(): AppState {
  const panel = usePanelState()
  // 保存の直前の照合で上書きがキャンセルされたタブは、監視と同じ外部変更の確認を通して印を付ける(印を直接付けると
  // 「このまま編集する」で消した後にフォーカスの復帰で出し直す)。保存できたら印を消す
  const externalChangeMarks = useExternalChangeMarks()
  // 保存できたパスを、エージェントの変更の記録(useAgentChangesRecording。フォルダに依存するため後で作る)へも知らせる
  const savedPathListenerRef = useRef<(path: string) => void>(() => undefined)
  const fileSystem = useFileSystem({
    onSaveConflict: externalChangeMarks.requestCheck,
    onSaveSucceeded: (path) => {
      externalChangeMarks.clear(path)
      savedPathListenerRef.current(path)
    }
  })
  // エージェントの変更の記録・一覧(main の registry の写し)と、記録を始めてから一覧を取る操作(組み立ての前段)
  const agentChangesRecording = useAgentChangesRecording(fileSystem.folderPath)
  const { markSaved: markAgentChangesSaved } = agentChangesRecording.changes
  useLayoutEffect(() => {
    savedPathListenerRef.current = markAgentChangesSaved
  }, [markAgentChangesSaved])
  const prompts = usePrompts()
  const progress = useProgressTasks()
  const git = useGitStatus(fileSystem.folderPath)
  // ファイル全体の stage/unstage(useGitOperations)とハンク単位の stage/unstage
  // (useDiffOperations)は、どちらも同じ .git/index を書き換える(git add/reset と
  // git apply --cached)。別々のロックのままだと、同じファイルに対して片方が
  // 実行中でももう片方の操作が弾かれず、index への同時書き込みが競合してしまう
  const fileOperationLock = useFileOperationLock()
  const gitOperations = useGitOperations(git.refreshGitStatus, fileOperationLock)
  const diffTabs = useDiffTabs()
  const diffOperations = useDiffOperations(
    diffTabs.activeDiffTab,
    git.refreshGitStatus,
    git.gitStatus?.files ?? [],
    fileOperationLock
  )
  const gitHistory = useGitHistory(fileSystem.folderPath)
  // 初回 push(pushSetUpstream)の後は upstream と履歴のリモートの ref が変わるため、履歴も取り直す(差分 3)。
  // 履歴の再取得(gitHistory.refresh)に依存するため、gitHistory より後に配置する
  const gitRemoteOperations = useGitRemoteOperations(
    git.gitStatus,
    git.refreshGitStatus,
    fileOperationLock,
    gitHistory.refresh
  )
  // ブランチ切替はブランチ一覧の再取得(gitHistory.refresh)に依存するため、
  // gitHistory より後に配置する必要がある
  const gitBranchOperations = useGitBranchOperations(
    git.gitStatus,
    git.refreshGitStatus,
    gitHistory.refresh,
    fileOperationLock
  )
  // タグの作成は作業ツリーを変えないため、再取得は履歴(ログ・ブランチ・タグ)だけ。他の Git 操作の
  // 途中(HEAD が動く間)は実行しないよう、ブランチ操作などと同じロックを渡す(ロック自体は取らない)
  const gitTag = useGitTagOperations(git.gitStatus, gitHistory.refresh, fileOperationLock)
  // 初期化・origin の追加。他の Git 操作の途中は実行しないよう、同じロックを渡す(ロック自体は取らない)
  const gitRemoteSetup = useGitRemoteSetup(
    git.gitStatus,
    git.refreshGitStatus,
    gitHistory.refresh,
    fileOperationLock
  )
  // 初回 push は push と実行中フラグ・エラーの表示先を共有するため useGitRemoteOperations が持つ。
  // バナーに渡す状態として 1 つにまとめる(差分 8)
  const remoteSetup: RemoteSetupPanelState = {
    ...gitRemoteSetup,
    isSettingUpstream: gitRemoteOperations.isSettingUpstream,
    isPushing: gitRemoteOperations.isPushing,
    isPushBlocked: gitRemoteOperations.isPushBlocked,
    remoteOperationError: gitRemoteOperations.remoteOperationError,
    pushSetUpstream: gitRemoteOperations.pushSetUpstream
  }
  const settings = useSettings()
  const execution = usePromptExecution()
  const history = useHistory()
  // 実行方式とエージェント(ターミナル・セッション・送信)。実行方式の切り替えの手順と、フォルダの切り替えの前の停止の確認を持つ
  const agentWorkspace = useAgentWorkspace({
    folderPath: fileSystem.folderPath,
    isExecuting: execution.isExecuting,
    // プロンプトの「実行」で送る前に、エージェントの変更の記録を始める(記録があれば main は何もしない)
    beforeAgentSend: agentChangesRecording.beginAndRefresh
  })
  const promptRunner = usePromptRunner({
    openFile: fileSystem.openFile,
    executePrompt: execution.executePrompt,
    addHistoryEntry: history.addHistoryEntry,
    executionMode: agentWorkspace.executionModePanel.mode,
    sendToAgent: agentWorkspace.sendToAgent
  })
  const { confirmStopAgent } = agentWorkspace
  const openFolder: typeof fileSystem.openFolder = async () => {
    if (!confirmStopAgent(AGENT_STOP_ON_FOLDER_CHANGE_CONFIRM)) return
    await fileSystem.openFolder()
  }
  // isUntracked(useDiffOperations.ts)は renderer 側の gitStatus.files から渡す
  // 設計のため、開いている diff タブの対象ファイルが gitStatus.files から消える
  // (.gitignore 追加・コミット等で追跡対象外になる)と、そのまま診断すると誤った
  // diff(「差分なし」等)が表示され続けてしまう。gitStatus.files から消えたら
  // タブ自体を閉じることで、誤表示ではなく「タブが消える」という分かりやすい
  // 挙動にする。gitStatus が null(フォルダ未読み込み等)の間は判定しない
  useEffect(() => {
    const files = git.gitStatus?.files
    if (files === undefined) return
    for (const tab of diffTabs.diffTabs) {
      // エージェントの変更の diff タブは git status ではなく、エージェントの変更の一覧から消えたときに閉じる
      if (tab.kind === 'agent') continue
      // 素の Set.has(文字列) だと、Windows のドライブレター大文字小文字違い等の
      // 表記揺れで一致しなくなり、まだ存在するファイルの diff タブを誤って
      // 閉じてしまう(ユーザーが見ている最中のタブが消える)。isSamePath で
      // 同じ表記揺れを吸収する
      const file = files.find((f) => isSamePath(f.path, tab.path))
      // パスが gitStatus.files に存在するかだけでは不十分。ファイル X を
      // ステージして staged diff タブを開いた後に X を unstage しても、
      // X は index=' ', workingDir='M'(unstaged 扱い)として files に残り
      // 続けるため、パスの存在確認だけでは閉じるべき staged タブが
      // 閉じられず、開いても「差分はありません」が表示され続けるゴミタブに
      // なる。タブが指す方向(staged/unstaged)に対応する変更が実際にまだ
      // あるかまで見る。unstaged 側の判定は isUnstagedFile(gitUtils.ts)を
      // ChangesSection.tsx の一覧フィルタと共有し、片方だけ判定基準がずれる
      // ことを防ぐ
      const stillHasMatchingDiff =
        file !== undefined && (tab.kind === 'staged' ? isStagedFile(file) : isUnstagedFile(file))
      if (!stillHasMatchingDiff) {
        diffTabs.closeDiffTab(tab)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [git.gitStatus?.files])

  // 上の「gitStatus.files に存在しない diffTab を閉じる」判定は path 文字列が
  // 存在するかしか見ないため、切替先フォルダに偶然同じ相対パスのファイルが
  // 存在すると、そのタブは閉じられず、古いフォルダの diff タブが無関係な
  // 新フォルダの同名ファイルを指してしまう。フォルダ切替時は無条件に
  // 全 diff タブを閉じることで、この取り違えを構造的に防ぐ。
  // ただし「初回マウント」自体は folderPath の変化ではないため、
  // useOnChange が実際に値が変わった場合のみ呼ぶ
  // (これが無いと、マウント直後にも毎回無条件で closeDiffTab が呼ばれてしまう)
  useOnChange(fileSystem.folderPath, () => {
    for (const tab of diffTabs.diffTabs) {
      diffTabs.closeDiffTab(tab)
    }
  })

  // ファイルを開く経路(エクスプローラー・クイックオープン共通)では、開いた瞬間に
  // diff タブを非アクティブ化する。そうしないと diff タブを表示したままファイルを
  // 開いても、タブバーのハイライト・本文表示が diff タブに固定されたままになる
  // fileSystem.selectFile は破棄確認のキャンセルや読み込み失敗で false を返す。
  // 先に非アクティブ化してしまうと、ファイルは開かれないのに読んでいた diff 表示
  // だけが消えてしまう(実ファイルタブが無ければプレースホルダになる)ため、
  // 実際に開けたときだけ非アクティブ化する(下の activateTab ラッパーと同じ扱い)
  const selectFile: typeof fileSystem.selectFile = async (node, options) => {
    const opened = await fileSystem.selectFile(node, options)
    if (opened) diffTabs.deactivateDiffTab()
    return opened
  }
  // 既存タブへの切り替え経路も同じ理由で非アクティブ化する。タブバーからの
  // 切り替えは useCombinedEditorTabs 側でも非アクティブ化しているが、生の
  // activateTab をそのまま公開したままだと、後から増えた呼び出し経路
  // (履歴からの再オープン等)がこの不変条件を素通りして「diff タブから
  // 実ファイルタブへ戻れない」不具合を再発させてしまう。
  // deactivateDiffTab は setActiveDiffTab(null) のみで冪等のため、
  // タブバー経路で二重に呼ばれても副作用は無い
  // fileSystem.activateTab は開いていないパスを渡されると何もせず false を返す。
  // 先に非アクティブ化してしまうと、実ファイルタブは切り替わらないのに diff タブ
  // だけが非アクティブになり、どちらも表示されない状態になるため、実際に
  // 切り替わったときだけ非アクティブ化する
  const activateTab: typeof fileSystem.activateTab = (path) => {
    const activated = fileSystem.activateTab(path)
    if (activated) diffTabs.deactivateDiffTab()
    return activated
  }
  // 保存はワーキングツリーの内容を変えるため、開いている diff タブの内容も
  // git status も古くなる。エディタでの保存は git status のステータス文字を
  // 変えない(既に " M" のファイルを編集・保存しても " M" のまま)ので、diff タブの
  // 自動再取得(activeFileStatusKey 依存)では検知できない。明示的に取り直さないと、
  // 保存前の古い diffContent から作った patch を「このハンクをステージ」で
  // 送ってしまい、ユーザーが一度も意図していない内容が index に入る。
  //
  // useFileEditing.saveFile は書き込み失敗を自前で catch して saveError に
  // 反映するだけで例外を再スローしない(Promise は常に成功で解決する)ため、
  // 保存が実際に失敗していても、以降の再取得は無条件に実行される。この場合
  // ワーキングツリーは変わっていないので、無駄な再取得が1回走るだけで実害はない。
  //
  // 新規ファイルの保存や、保存によって差分が無くなる編集では git status 自体も
  // 変わる(未追跡→追跡、変更あり→変更なし等)ため、diffRefreshSignal(diff の
  // 再取得トリガー)より先に refreshGitStatus を完了させる。runHunkOperation と
  // 同じ順序: 先に diff を取り直すと、その getDiff が refreshGitStatus 完了前の
  // 古い gitStatusFiles を見て isUntracked を誤判定してしまう
  // (「untracked diff が誤表示される」のと同じ原因のバグを再発させるレース)
  const saveFile: typeof fileSystem.saveFile = async () => {
    await fileSystem.saveFile()
    await git.refreshGitStatus()
    diffOperations.refreshDiff()
  }
  // createFile/createDirectory/renameEntry/deleteEntry(Explorer からのファイル
  // 操作)も saveFile と同じ理由で git status を取り直す必要がある。取り直さないと、
  // リネーム/削除したファイルの gitStatus が古いまま残り、Source Control パネルの
  // 表示が古いままになるだけでなく、上の「gitStatus.files から消えた diffTab を
  // 自動で閉じる」effect も発火しないため、存在しなくなったパスに対して diff タブの
  // ステージ/アンステージ操作が可能なまま残ってしまう
  const createFile: typeof fileSystem.createFile = async (parentPath, name) => {
    await fileSystem.createFile(parentPath, name)
    await git.refreshGitStatus()
  }
  const createDirectory: typeof fileSystem.createDirectory = async (parentPath, name) => {
    await fileSystem.createDirectory(parentPath, name)
    await git.refreshGitStatus()
  }
  const renameEntry: typeof fileSystem.renameEntry = async (node, newName) => {
    await fileSystem.renameEntry(node, newName)
    await git.refreshGitStatus()
  }
  const deleteEntry: typeof fileSystem.deleteEntry = async (node) => {
    await fileSystem.deleteEntry(node)
    await git.refreshGitStatus()
  }
  // checkout は working tree のファイルを直接書き換えるが、エディタのバッファは
  // このフック外で保持されているため連動しない。確認なしに切り替えると、
  // 切替前の内容を編集したまま保存した際に切替後のブランチのファイルを無警告で
  // 上書きしてしまう(コードレビュー指摘)。dirty なタブが無くても、切替先の
  // 内容を表示するためには全タブの再読込が必要になる(dirty でないタブも
  // 古いブランチの内容を表示し続けてしまうため)。
  // gitBranchOperations.checkoutBranch は git レベルの失敗(切替先ブランチと
  // 衝突する未コミット変更がある等)でも例外を投げず false を返すだけなので、
  // 失敗時に再読込すると無関係な未保存編集がディスク内容でサイレントに上書きされる
  // (コードレビュー指摘、2周目)。確認・成功時のみ再読込の手順は
  // runEditorSyncedOperation に集約している。
  //
  // 既知の制約(コードレビュー指摘、2周目で検討・スコープ外と判断): checkout
  // 実行中(IPC往復 + branchLocal + checkout + refreshGitStatus/refreshHistory、
  // 通常は短時間)に、開いたままの対象ファイルへ saveFile が割り込むと、
  // その保存内容が新ブランチのファイルへ反映され、reloadOpenFiles がそれを
  // 「ディスクの最新内容」としてそのままクリーン扱いしてしまう(レースで
  // 混在した内容が気づかれずに残る)。saveFile は lock.isAnyLocked() を見ておらず、
  // pull(working tree/index を書き換える点は checkout と同じ)にも既に同種の
  // レースがあり checkout 固有の問題ではないため、今回は特別扱いしない。
  // 対応するには saveFile 側に lock 待ちを組み込む設計変更が必要で、
  // ブランチ切替機能のスコープを超える
  const checkoutBranch: (branchName: string) => Promise<void> = (branchName) =>
    runEditorSyncedOperation({
      confirmDiscardAnyDirty: fileSystem.confirmDiscardAnyDirty,
      reloadOpenFiles: fileSystem.reloadOpenFiles,
      operation: () => gitBranchOperations.checkoutBranch(branchName)
    })
  // マージも checkout と同じく working tree を書き換えるため、同じ手順
  // (runEditorSyncedOperation)で扱う。gitBranchOperations.mergeBranch は、作業ツリーが変わったとき
  // (成功と、コンフリクトでマージ中の状態を残して止まった場合)だけ true を返す。コンフリクトでも
  // 再読込するのは、古い内容のタブを保存するとマーカーと相手側の変更が消えるため(パターン52)。
  // 事前検証の失敗など作業ツリーが変わらない失敗は false で、再読込されない。
  // ファイルツリーの再読込は checkout と同じく行わない(ブランチ操作の既存の制約)
  const mergeBranch: (branchName: string) => Promise<void> = (branchName) =>
    runEditorSyncedOperation({
      confirmDiscardAnyDirty: fileSystem.confirmDiscardAnyDirty,
      reloadOpenFiles: fileSystem.reloadOpenFiles,
      operation: () => gitBranchOperations.mergeBranch(branchName)
    })
  // 退避の一覧・操作と、未保存編集の破棄確認・ツリー/タブの再読込の組み立ては
  // useStashPanel に任せ、ここでは依存を渡すだけにする
  const stash = useStashPanel({
    folderPath: fileSystem.folderPath,
    gitStatus: git.gitStatus,
    refreshGitStatus: git.refreshGitStatus,
    fileOperationLock,
    confirmDiscardAnyDirty: fileSystem.confirmDiscardAnyDirty,
    reloadOpenFiles: fileSystem.reloadOpenFiles,
    refreshTree: fileSystem.refreshTree
  })
  // clone は Git 操作の実行中は始めない(判定の中身と理由は lib/gitOperationActivity)。退避の実行中フラグ
  // (stash.pendingOperation)を読むため、useStashPanel より後ろに置く
  const isGitOperationRunning = isAnyGitOperationRunning({
    isAnyLocked: fileOperationLock.isAnyLocked(),
    isPushing: gitRemoteOperations.isPushing,
    isFetching: gitRemoteOperations.isFetching,
    isSettingUpstream: gitRemoteOperations.isSettingUpstream,
    pendingBranchOperation: gitBranchOperations.pendingBranchOperation,
    stashPendingOperation: stash.pendingOperation,
    isCreatingTag: gitTag.isCreating,
    isInitializing: gitRemoteSetup.isInitializing,
    isAddingOrigin: gitRemoteSetup.isAddingOrigin
  })
  const clone = useCloneRepository({
    captureDirtySnapshot: fileSystem.captureDirtySnapshot,
    // clone はフォルダを切り替えるため、「フォルダを変更」と同じくエージェントの終了も確かめる
    confirmDiscardAnyDirty: () =>
      confirmStopAgent(AGENT_STOP_ON_FOLDER_CHANGE_CONFIRM) && fileSystem.confirmDiscardAnyDirty(),
    applyOpenedFolder: fileSystem.applyOpenedFolder,
    lock: fileOperationLock,
    isGitOperationRunning
  })
  // 変更の取り消しは、確認・取り消し・エディタのタブ同期の組み立てを
  // useDiscardFileChanges に任せ、ここでは依存を渡すだけにする
  const discardFile = useDiscardFileChanges({
    folderPath: fileSystem.folderPath,
    files: git.gitStatus?.files ?? [],
    discardFile: gitOperations.discardFile,
    hasDirtyTabAtOrInside: fileSystem.hasDirtyTabAtOrInside,
    reloadOpenFile: fileSystem.reloadOpenFile,
    closeTabsAtOrInside: fileSystem.closeTabsAtOrInside,
    refreshTree: fileSystem.refreshTree
  })
  // ハンクの取り消しも同様。useDiffOperations.discardHunk(確認なしの boolean 版)は
  // ここで確認・タブ同期つきのものに差し替える(名前の衝突を避けるため別名で受ける)
  const discardHunk = useDiscardHunk({
    folderPath: fileSystem.folderPath,
    activeDiffTabPath: diffTabs.activeDiffTab?.path ?? null,
    discardHunk: diffOperations.discardHunk,
    hasDirtyTabAtOrInside: fileSystem.hasDirtyTabAtOrInside,
    reloadOpenFile: fileSystem.reloadOpenFile,
    refreshTree: fileSystem.refreshTree
  })
  // 変更の一括取り消しは、確認・排他・タブとツリーの再読込を useDiscardAllChanges に任せる
  const discardAll = useDiscardAllChanges({
    gitStatus: git.gitStatus,
    refreshGitStatus: git.refreshGitStatus,
    fileLock: fileOperationLock,
    confirmDiscardAnyDirty: fileSystem.confirmDiscardAnyDirty,
    reloadOpenFiles: fileSystem.reloadOpenFiles,
    refreshTree: fileSystem.refreshTree
  })
  // マージの完了・中止は、確認・排他・タブとツリーの再読込を useMergeState に任せる。
  // マージを始めたときの通知「コンフリクトしました（…）」の消去は useMergeState には渡さず、
  // useGitBranchOperations が gitStatus.mergeInProgress の解除に連動して行う
  const mergeState = useMergeState({
    gitStatus: git.gitStatus,
    refreshGitStatus: git.refreshGitStatus,
    refreshHistory: gitHistory.refresh,
    fileLock: fileOperationLock,
    confirmDiscardAnyDirty: fileSystem.confirmDiscardAnyDirty,
    reloadOpenFiles: fileSystem.reloadOpenFiles,
    refreshTree: fileSystem.refreshTree
  })
  // 未解決ファイルの解決ビュー(diff タブ)の状態と操作は useConflictFile に任せる
  // 解決ビューの対象は「マージ中で、アクティブな diff タブのファイルがコンフリクト中」のときだけ
  // (解決済みになれば null)。CLI の rebase / cherry-pick 中(MERGE_HEAD が無い)は ours/theirs の
  // 意味が違うため解決ビューを出さず(getConflictFile も呼ばない)、通常の diff 表示にする。
  // main 側の解決操作もマージ中でなければ拒否する
  // エージェントの変更の diff タブは解決ビューにしない(記録の時点との比較のため)
  const activeDiffPath =
    diffTabs.activeDiffTab !== null && diffTabs.activeDiffTab.kind !== 'agent'
      ? diffTabs.activeDiffTab.path
      : null
  const conflictActivePath =
    activeDiffPath !== null &&
    git.gitStatus?.mergeInProgress === true &&
    (git.gitStatus?.files ?? []).some((f) => f.path === activeDiffPath && isConflictedFile(f))
      ? activeDiffPath
      : null
  const isActiveFileConflicted = conflictActivePath !== null
  const conflictFile = useConflictFile({
    activePath: conflictActivePath,
    gitStatus: git.gitStatus,
    refreshGitStatus: git.refreshGitStatus,
    fileLock: fileOperationLock,
    hasDirtyTabAtOrInside: fileSystem.hasDirtyTabAtOrInside,
    reloadOpenFile: fileSystem.reloadOpenFile,
    refreshTree: fileSystem.refreshTree,
    folderPath: fileSystem.folderPath
  })
  // 他のフックと違いキー名の衝突を避けて quickOpen 名前空間にまとめる
  // (isOpen / query / results のような汎用的な名前を App 直下に展開しないため)
  const quickOpen = useQuickOpen({
    fileTree: fileSystem.fileTree,
    folderPath: fileSystem.folderPath,
    openFilePath: fileSystem.openFile?.path ?? null,
    openedFileSignal: fileSystem.openedFileSignal,
    folderLoadError: fileSystem.folderLoadError,
    selectFile
  })
  // 開いているタブの外部変更の検知(実行方式に関係なく常に有効)。diff タブの表示中は通知を出さない
  const externalChangeBanner = useExternalFileChanges({
    openFiles: fileSystem.openFiles,
    activeFilePath: fileSystem.activeFilePath,
    isFileTabActive: diffTabs.activeDiffTab === null,
    getOpenFileSnapshot: fileSystem.getOpenFileSnapshot,
    waitForPendingSave: fileSystem.waitForPendingSave,
    replaceCleanTabWithDisk: fileSystem.replaceCleanTabWithDisk,
    reloadOpenFile: fileSystem.reloadOpenFile,
    marks: externalChangeMarks,
    // main はフォルダが変わると監視を閉じる。タブが残る切り替えでも監視の対象を送り直す
    folderPath: fileSystem.folderPath
  })
  // エージェントの変更の組み立ての後段(一覧を取り直す契機・diff タブの同期・戻す操作・表示用の値)。effect の順序を
  // 変えないため、ほかの hook の後(この位置)で呼ぶ
  const agentChangesWiring = useAgentChangesWiring({
    folderPath: fileSystem.folderPath,
    recording: agentChangesRecording,
    gitStatus: git.gitStatus,
    refreshGitStatus: git.refreshGitStatus,
    agentSessionExit: agentWorkspace.agentTerminal.sessions.lastExit,
    agentRunning: agentWorkspace.agentTerminal.sessions.isAnyActive,
    isAgentMode: agentWorkspace.executionModePanel.mode === 'agent-cli',
    diffTabs,
    refreshDiff: diffOperations.refreshDiff,
    fileLock: fileOperationLock,
    fileSystem,
    showSourceControl: () => panel.showPanel('source-control')
  })
  return {
    quickOpen,
    isLocked: fileOperationLock.isLocked,
    isAnyLocked: fileOperationLock.isAnyLocked,
    ...panel,
    ...fileSystem,
    ...prompts,
    ...progress,
    ...git,
    ...gitOperations,
    ...gitRemoteOperations,
    ...diffTabs,
    ...diffOperations,
    ...gitHistory,
    ...gitBranchOperations,
    ...settings,
    ...execution,
    ...history,
    ...promptRunner,
    // fileSystem の生の selectFile/activateTab/createFile/createDirectory/
    // renameEntry/deleteEntry を git status 再取得込みのものへ差し替える。
    // オブジェクトの後勝ちで上書きするため、この位置(spread の後)に置く必要がある
    selectFile,
    activateTab,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    saveFile,
    checkoutBranch,
    mergeBranch,
    stash,
    discardFile,
    // ...diffOperations の生の discardHunk(boolean 版)を、確認・同期つきのもので上書きする。
    // spread の後に置く必要がある
    discardHunk,
    discardAll,
    gitTag,
    remoteSetup,
    clone,
    mergeState,
    conflictFile,
    isActiveFileConflicted,
    openFolder,
    executionModePanel: agentWorkspace.executionModePanel,
    agentNotificationPanel: agentWorkspace.agentNotificationPanel,
    promptRun: agentWorkspace.promptRun,
    bottomPanel: agentWorkspace.bottomPanel,
    agentTerminal: agentWorkspace.agentTerminal,
    statusBarAgent: agentWorkspace.statusBarAgent,
    agentAnnouncement: agentWorkspace.agentAnnouncement,
    externalChangeBanner,
    ...agentChangesWiring
  }
}
