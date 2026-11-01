import { useCallback, useEffect, useRef, useState } from 'react'
import type { PanelLayout } from '@shared/panelLayout'
import {
  DEFAULT_PANEL_LAYOUT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  TERMINAL_HEIGHT_PERCENT_MAX,
  TERMINAL_HEIGHT_PERCENT_MIN,
  clampNumber
} from '@shared/panelLayout'
import { getPanelLayout, setPanelLayout } from '../lib/settingsApi'

export interface PanelLayoutState {
  layout: PanelLayout
  changeSidebarWidth: (value: number) => void
  changeTerminalHeightPercent: (value: number) => void
  /** 今の値を保存する。ドラッグの終わりとキー操作で呼ぶ */
  commit: () => void
}

// サイドバーの幅とターミナルの高さの状態と保存。読み込みが終わる前に変えた項目は上書きしない。保存の失敗は記録だけにする
// (大きさの操作は続けられる)。保存は全項目を書くので、読み込みの前は保存を待ち、読み込みに失敗したら保存しない(変えていない
// 項目を既定値で上書きしない)
export function usePanelLayout(): PanelLayoutState {
  const [layout, setLayout] = useState<PanelLayout>(DEFAULT_PANEL_LAYOUT)
  // 同じ tick の change と commit で新しい値を保存するため、change の中で同期に更新する
  const layoutRef = useRef(layout)
  const changedRef = useRef<Set<keyof PanelLayout>>(new Set())
  const loadStateRef = useRef<'loading' | 'loaded' | 'failed'>('loading')
  const commitAfterLoadRef = useRef(false)

  const save = useCallback((): void => {
    void setPanelLayout(layoutRef.current).catch((err: unknown) => {
      console.error('[usePanelLayout] save failed:', err)
    })
  }, [])

  const change = useCallback((key: keyof PanelLayout, value: number): void => {
    changedRef.current.add(key)
    if (layoutRef.current[key] === value) return
    const next = { ...layoutRef.current, [key]: value }
    layoutRef.current = next
    setLayout(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async (): Promise<void> => {
      try {
        const saved = await getPanelLayout()
        if (cancelled) return
        const next = { ...saved }
        for (const key of changedRef.current) next[key] = layoutRef.current[key]
        layoutRef.current = next
        setLayout(next)
        loadStateRef.current = 'loaded'
        if (commitAfterLoadRef.current) save()
      } catch (err) {
        loadStateRef.current = 'failed'
        console.error('[usePanelLayout] load failed:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [save])

  const changeSidebarWidth = useCallback(
    (value: number) =>
      change('sidebarWidth', clampNumber(value, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX)),
    [change]
  )
  const changeTerminalHeightPercent = useCallback(
    (value: number) =>
      change(
        'terminalHeightPercent',
        clampNumber(value, TERMINAL_HEIGHT_PERCENT_MIN, TERMINAL_HEIGHT_PERCENT_MAX)
      ),
    [change]
  )
  const commit = useCallback((): void => {
    if (loadStateRef.current === 'loaded') save()
    else if (loadStateRef.current === 'loading') commitAfterLoadRef.current = true
  }, [save])

  return { layout, changeSidebarWidth, changeTerminalHeightPercent, commit }
}
