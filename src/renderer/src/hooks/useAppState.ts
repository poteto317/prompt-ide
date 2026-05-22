import { usePanelState } from './usePanelState'
import { useFileSystem } from './useFileSystem'
import { usePrompts } from './usePrompts'

export function useAppState() {
  const panel = usePanelState()
  const fileSystem = useFileSystem()
  const prompts = usePrompts()
  return { ...panel, ...fileSystem, ...prompts }
}
