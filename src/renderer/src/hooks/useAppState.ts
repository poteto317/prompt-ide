import { usePanelState } from './usePanelState'
import { useFileSystem } from './useFileSystem'
import { usePrompts } from './usePrompts'
import { useProgressTasks } from './useProgressTasks'
import { useGitStatus } from './useGitStatus'
import { useGitOperations } from './useGitOperations'
import { useSettings } from './useSettings'
import { usePromptExecution } from './usePromptExecution'
import { useHistory } from './useHistory'
import { usePromptRunner } from './usePromptRunner'
import { useQuickOpen } from './useQuickOpen'
import { useDiffTabs } from './useDiffTabs'
import { useDiffOperations } from './useDiffOperations'
import { useGitHistory } from './useGitHistory'

type AppState = { quickOpen: ReturnType<typeof useQuickOpen> } & ReturnType<typeof usePanelState> &
  ReturnType<typeof useFileSystem> &
  ReturnType<typeof usePrompts> &
  ReturnType<typeof useProgressTasks> &
  ReturnType<typeof useGitStatus> &
  ReturnType<typeof useGitOperations> &
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
  const gitOperations = useGitOperations(git.refreshGitStatus)
  const diffTabs = useDiffTabs()
  const diffOperations = useDiffOperations(diffTabs.activeDiffTab, git.refreshGitStatus)
  const gitHistory = useGitHistory(fileSystem.folderPath)
  const settings = useSettings()
  const execution = usePromptExecution()
  const history = useHistory()
  const promptRunner = usePromptRunner({
    openFile: fileSystem.openFile,
    executePrompt: execution.executePrompt,
    addHistoryEntry: history.addHistoryEntry
  })
  // ファイルを開く経路(エクスプローラー・クイックオープン共通)では、開いた瞬間に
  // diff タブを非アクティブ化する。そうしないと diff タブを表示したままファイルを
  // 開いても、タブバーのハイライト・本文表示が diff タブに固定されたままになる
  const selectFile: typeof fileSystem.selectFile = (node, options) => {
    diffTabs.deactivateDiffTab()
    return fileSystem.selectFile(node, options)
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
    ...panel,
    ...fileSystem,
    ...prompts,
    ...progress,
    ...git,
    ...gitOperations,
    ...diffTabs,
    ...diffOperations,
    ...gitHistory,
    ...settings,
    ...execution,
    ...history,
    ...promptRunner,
    // fileSystem の生の selectFile を diff タブ非アクティブ化込みのものへ差し替える。
    // オブジェクトの後勝ちで上書きするため、この位置(spread の後)に置く必要がある
    selectFile
  }
}
