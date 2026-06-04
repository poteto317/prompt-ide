import { useState, useEffect, useCallback, useRef } from 'react'

export type Transform<T> = (items: T[]) => T[]

interface BufferedPersistenceConfig<T> {
  load: () => Promise<T[]>
  save: (items: T[]) => void
}

interface BufferedPersistence<T> {
  items: T[]
  loaded: boolean
  apply: (transform: Transform<T>) => void
}

function applyTransforms<T>(initial: T[], transforms: Transform<T>[]): T[] {
  return transforms.reduce((items, transform) => transform(items), initial)
}

/**
 * ロード前のミューテーションをバッファリングし、ロード完了後にマージ・永続化する
 * 汎用永続化フック。ロード前は transform を貯めつつ即時に画面へ反映し、ロード後は
 * 各ミューテーションを保存する。
 */
export function useBufferedPersistence<T>({
  load,
  save
}: BufferedPersistenceConfig<T>): BufferedPersistence<T> {
  const itemsRef = useRef<T[]>([])
  const [items, setItems] = useState<T[]>([])
  const [loaded, setLoaded] = useState(false)
  // ロード完了前のミューテーションを保持し、ロード後にマージして適用する
  const pendingRef = useRef<Transform<T>[]>([])
  const loadedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    load()
      .then((loadedItems) => {
        if (cancelled) return
        const merged = applyTransforms(loadedItems, pendingRef.current)
        loadedRef.current = true
        itemsRef.current = merged
        setItems(merged)
        if (pendingRef.current.length > 0) save(merged)
        pendingRef.current = []
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        // ロード失敗時はバッファ中のミューテーションをそのまま確定させる
        loadedRef.current = true
        if (pendingRef.current.length > 0) save(itemsRef.current)
        pendingRef.current = []
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [load, save])

  const apply = useCallback(
    (transform: Transform<T>): void => {
      const next = transform(itemsRef.current)
      itemsRef.current = next
      setItems(next)
      if (!loadedRef.current) {
        pendingRef.current = [...pendingRef.current, transform]
        return
      }
      save(next)
    },
    [save]
  )

  return { items, loaded, apply }
}
