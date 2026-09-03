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
  ReturnType<typeof useGitHistory>

export function useAppState(): AppState {
  const panel = usePanelState()
  const fileSystem = useFileSystem()
  const prompts = usePrompts()
  const progress = useProgressTasks()
  const git = useGitStatus(fileSystem.folderPath)
  const gitOperations = useGitOperations(git.refreshGitStatus)
  const diffTabs = useDiffTabs()
  const gitHistory = useGitHistory(fileSystem.folderPath)
  const settings = useSettings()
  const execution = usePromptExecution()
  const history = useHistory()
  const promptRunner = usePromptRunner({
    openFile: fileSystem.openFile,
    executePrompt: execution.executePrompt,
    addHistoryEntry: history.addHistoryEntry
  })
  // 他のフックと違いキー名の衝突を避けて quickOpen 名前空間にまとめる
  // (isOpen / query / results のような汎用的な名前を App 直下に展開しないため)
  const quickOpen = useQuickOpen({
    fileTree: fileSystem.fileTree,
    folderPath: fileSystem.folderPath,
    openFilePath: fileSystem.openFile?.path ?? null,
    openedFileSignal: fileSystem.openedFileSignal,
    folderLoadError: fileSystem.folderLoadError,
    selectFile: fileSystem.selectFile
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
    ...gitHistory,
    ...settings,
    ...execution,
    ...history,
    ...promptRunner
  }
}
