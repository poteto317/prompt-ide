import { useEffect } from 'react'
import { usePanelState } from './usePanelState'
import { useFileSystem } from './useFileSystem'
import { usePrompts } from './usePrompts'
import { useProgressTasks } from './useProgressTasks'
import { useGitStatus } from './useGitStatus'
import { useGitOperations } from './useGitOperations'
import { useGitRemoteOperations } from './useGitRemoteOperations'
import { useSettings } from './useSettings'
import { usePromptExecution } from './usePromptExecution'
import { useHistory } from './useHistory'
import { usePromptRunner } from './usePromptRunner'
import { useQuickOpen } from './useQuickOpen'
import { useDiffTabs } from './useDiffTabs'
import { useDiffOperations } from './useDiffOperations'
import { useGitHistory } from './useGitHistory'
import { useFileOperationLock } from './useFileOperationLock'
import { useOnChange } from './useOnChange'
import { isSamePath } from '../lib/pathUtils'
import { isStagedFile, isUnstagedFile } from '../lib/gitUtils'

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
} & ReturnType<typeof usePanelState> &
  ReturnType<typeof useFileSystem> &
  ReturnType<typeof usePrompts> &
  ReturnType<typeof useProgressTasks> &
  ReturnType<typeof useGitStatus> &
  ReturnType<typeof useGitOperations> &
  ReturnType<typeof useGitRemoteOperations> &
  ReturnType<typeof useSettings> &
  ReturnType<typeof usePromptExecution> &
  ReturnType<typeof useHistory> &
  ReturnType<typeof usePromptRunner> &
  ReturnType<typeof useDiffTabs> &
  ReturnType<typeof useDiffOperations> &
  ReturnType<typeof useGitHistory>

export function useAppState(): AppState {
  const panel = usePanelState()
  const fileSystem = useFileSystem()
  const prompts = usePrompts()
  const progress = useProgressTasks()
  const git = useGitStatus(fileSystem.folderPath)
  // ファイル全体の stage/unstage(useGitOperations)とハンク単位の stage/unstage
  // (useDiffOperations)は、どちらも同じ .git/index を書き換える(git add/reset と
  // git apply --cached)。別々のロックのままだと、同じファイルに対して片方が
  // 実行中でももう片方の操作が弾かれず、index への同時書き込みが競合してしまう
  const fileOperationLock = useFileOperationLock()
  const gitOperations = useGitOperations(git.refreshGitStatus, fileOperationLock)
  const gitRemoteOperations = useGitRemoteOperations(
    git.gitStatus,
    git.refreshGitStatus,
    fileOperationLock
  )
  const diffTabs = useDiffTabs()
  const diffOperations = useDiffOperations(
    diffTabs.activeDiffTab,
    git.refreshGitStatus,
    git.gitStatus?.files ?? [],
    fileOperationLock
  )
  const gitHistory = useGitHistory(fileSystem.folderPath)
  const settings = useSettings()
  const execution = usePromptExecution()
  const history = useHistory()
  const promptRunner = usePromptRunner({
    openFile: fileSystem.openFile,
    executePrompt: execution.executePrompt,
    addHistoryEntry: history.addHistoryEntry
  })
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
        file !== undefined && (tab.staged ? isStagedFile(file) : isUnstagedFile(file))
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
    saveFile
  }
}
