import { useCallback, useEffect, useRef } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import type { Prompt } from '../types'
import { createPrompt } from '../lib/promptFactory'
import { usePromptsPersistence } from './usePromptsPersistence'
import { useBufferedPersistence } from './useBufferedPersistence'
import { usePromptTransfer } from './usePromptTransfer'

interface PromptsState {
  prompts: Prompt[]
  promptsLoaded: boolean
  addPrompt: (title: string, content: string) => void
  deletePrompt: (id: string) => void
  updatePrompt: (id: string, title: string, content: string, tags?: string[]) => void
  reorderPrompts: (activeId: string, overId: string) => void
  togglePromptPin: (id: string) => void
  exportPrompts: () => Promise<boolean>
  importPrompts: () => Promise<number>
}

export function usePrompts(): PromptsState {
  const { load, save } = usePromptsPersistence()
  const {
    items: prompts,
    loaded: promptsLoaded,
    apply
  } = useBufferedPersistence<Prompt>({ load, save })

  // loaded 状態を ref に写し、togglePromptPin の依存配列を [apply] のまま（参照安定）にする
  const loadedRef = useRef(false)
  useEffect(() => {
    loadedRef.current = promptsLoaded
  }, [promptsLoaded])

  // インポート/エクスポートは専用フックへ委譲（永続化は apply 経由で共有）
  const { exportPrompts, importPrompts } = usePromptTransfer(prompts, apply)

  const addPrompt = useCallback(
    (title: string, content: string): void => {
      const newPrompt = createPrompt(title, content)
      apply((prompts) => [...prompts, newPrompt])
    },
    [apply]
  )

  const deletePrompt = useCallback(
    (id: string): void => {
      apply((prompts) => prompts.filter((p) => p.id !== id))
    },
    [apply]
  )

  const updatePrompt = useCallback(
    (id: string, title: string, content: string, tags?: string[]): void => {
      apply((prompts) =>
        prompts.map((p) => {
          if (p.id !== id) return p
          const next = { ...p, title, content }
          if (tags !== undefined) next.tags = tags.length > 0 ? tags : undefined
          return next
        })
      )
    },
    [apply]
  )

  const reorderPrompts = useCallback(
    (activeId: string, overId: string): void => {
      // インデックス計算を transform 内部で行うことで、常に最新の配列を基準に並び替える
      // （クロージャの prompts を参照しないため stale closure を回避し、参照も安定する）。
      // 順序が変わらない場合は同一参照を返し、apply 側の no-op 検出で save をスキップする。
      apply((currentPrompts) => {
        const activeIndex = currentPrompts.findIndex((p) => p.id === activeId)
        const overIndex = currentPrompts.findIndex((p) => p.id === overId)
        if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
          return currentPrompts
        }
        // ピン済み/非ピン済みの境界をまたぐ並び替えは永続化データを壊すためスキップする
        if (!!currentPrompts[activeIndex].pinned !== !!currentPrompts[overIndex].pinned) {
          return currentPrompts
        }
        return arrayMove(currentPrompts, activeIndex, overIndex)
      })
    },
    [apply]
  )

  const togglePromptPin = useCallback(
    (id: string): void => {
      apply((currentPrompts) => {
        // ロード後に対象IDが存在しない場合は同一参照を返し、不要な state 更新・save を避ける。
        // ロード前は currentPrompts が未確定なため常に新配列を返し、ロード後にマージさせる。
        if (loadedRef.current && !currentPrompts.some((p) => p.id === id)) {
          return currentPrompts
        }
        return currentPrompts.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p))
      })
    },
    [apply]
  )

  return {
    prompts,
    promptsLoaded,
    addPrompt,
    deletePrompt,
    updatePrompt,
    reorderPrompts,
    togglePromptPin,
    exportPrompts,
    importPrompts
  }
}
