import { usePanelState } from './usePanelState'
import { useFileSystem } from './useFileSystem'
import { usePrompts } from './usePrompts'
import { useGitStatus } from './useGitStatus'

export function useAppState() {
  const panel = usePanelState()
  const fileSystem = useFileSystem()
  const prompts = usePrompts()
  const git = useGitStatus(fileSystem.folderPath)
  return { ...panel, ...fileSystem, ...prompts, ...git }
}
