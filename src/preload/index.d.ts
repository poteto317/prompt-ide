import { ElectronAPI } from '@electron-toolkit/preload'
import type { FileTreeNode } from '@shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openFolder(): Promise<string | null>
      readDirectory(path: string): Promise<FileTreeNode[]>
      readFile(path: string): Promise<string>
    }
  }
}
