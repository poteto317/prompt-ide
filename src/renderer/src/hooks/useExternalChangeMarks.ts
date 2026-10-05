import { useCallback, useRef, useState } from 'react'
import type { ExternalChangeKind } from '@shared/types'
import { toComparablePath } from '../lib/pathUtils'

// 編集中のタブの外部変更の印(設計書「編集中のタブへの通知」)。パスの表記揺れ(Windows の大文字小文字)を吸収して持つ
export interface ExternalChangeMarks {
  get: (path: string) => ExternalChangeKind | null
  mark: (path: string, kind: ExternalChangeKind) => void
  clear: (path: string) => void
  /** 開いているタブ以外の印を捨てる */
  retain: (paths: readonly string[]) => void
  /**
   * 外部変更の確認を依頼する(保存の直前の照合で上書きをキャンセルしたとき)。確認の受け手(useExternalFileChanges)が
   * ディスクを読んで印を付けるので、「このまま編集する」で消した後に同じ内容で出し直さない。受け手が無ければ kind の印を付ける
   */
  requestCheck: (path: string, kind: ExternalChangeKind) => void
  /** 確認の受け手を登録する。戻り値で解除する(後から登録された受け手は外さない) */
  setCheckHandler: (handler: (path: string) => void) => () => void
}

export function useExternalChangeMarks(): ExternalChangeMarks {
  const [marks, setMarks] = useState<ReadonlyMap<string, ExternalChangeKind>>(() => new Map())

  const get = useCallback(
    (path: string): ExternalChangeKind | null => marks.get(toComparablePath(path)) ?? null,
    [marks]
  )
  const mark = useCallback((path: string, kind: ExternalChangeKind): void => {
    setMarks((prev) => {
      const key = toComparablePath(path)
      if (prev.get(key) === kind) return prev
      const next = new Map(prev)
      next.set(key, kind)
      return next
    })
  }, [])
  const clear = useCallback((path: string): void => {
    setMarks((prev) => {
      const key = toComparablePath(path)
      if (!prev.has(key)) return prev
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }, [])
  const retain = useCallback((paths: readonly string[]): void => {
    setMarks((prev) => {
      const keep = new Set(paths.map(toComparablePath))
      if ([...prev.keys()].every((key) => keep.has(key))) return prev
      return new Map([...prev].filter(([key]) => keep.has(key)))
    })
  }, [])
  const checkHandlerRef = useRef<((path: string) => void) | null>(null)
  const requestCheck = useCallback(
    (path: string, kind: ExternalChangeKind): void => {
      const handler = checkHandlerRef.current
      if (handler === null) mark(path, kind)
      else handler(path)
    },
    [mark]
  )
  const setCheckHandler = useCallback((handler: (path: string) => void): (() => void) => {
    checkHandlerRef.current = handler
    return () => {
      if (checkHandlerRef.current === handler) checkHandlerRef.current = null
    }
  }, [])
  return { get, mark, clear, retain, requestCheck, setCheckHandler }
}
