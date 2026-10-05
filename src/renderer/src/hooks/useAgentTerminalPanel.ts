import { useCallback, useState } from 'react'

// ターミナルのパネルの開閉・最大化(保存しない。設計書「配置の案」)
export interface AgentTerminalPanelLayout {
  isOpen: boolean
  isMaximized: boolean
  open: () => void
  toggleOpen: () => void
  toggleMaximized: () => void
}

export function useAgentTerminalPanel(): AgentTerminalPanelLayout {
  const [layout, setLayout] = useState({ isOpen: true, isMaximized: false })
  const open = useCallback(
    () => setLayout((prev) => (prev.isOpen ? prev : { ...prev, isOpen: true })),
    []
  )
  // 閉じるときは最大化も戻す(閉じたパネルが領域を占めない)
  const toggleOpen = useCallback(
    () =>
      setLayout((prev) =>
        prev.isOpen ? { isOpen: false, isMaximized: false } : { ...prev, isOpen: true }
      ),
    []
  )
  // 最大化はパネルを開いてから行う
  const toggleMaximized = useCallback(
    () => setLayout((prev) => ({ isOpen: true, isMaximized: !prev.isMaximized })),
    []
  )
  return { ...layout, open, toggleOpen, toggleMaximized }
}
