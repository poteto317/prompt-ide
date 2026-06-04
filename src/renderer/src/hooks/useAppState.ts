import { usePanelState } from './usePanelState'
import { useFileSystem } from './useFileSystem'
import { usePrompts } from './usePrompts'
import { useProgressTasks } from './useProgressTasks'
import { useGitStatus } from './useGitStatus'
import { useSettings } from './useSettings'
import { usePromptExecution } from './usePromptExecution'

export function useAppState() {
  const panel = usePanelState()
  const fileSystem = useFileSystem()
  const prompts = usePrompts()
  const progress = useProgressTasks()
  const git = useGitStatus(fileSystem.folderPath)
  const settings = useSettings()
  const execution = usePromptExecution()
  return { ...panel, ...fileSystem, ...prompts, ...progress, ...git, ...settings, ...execution }
}
