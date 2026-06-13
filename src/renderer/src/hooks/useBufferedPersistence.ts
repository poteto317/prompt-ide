import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * items を受け取り、変更後の配列を返す純粋関数。
 *
 * 【重要な前提】変更を加える場合は必ず新しい配列参照を返すこと。
 * `apply` は「返り値が引数と同一参照（`next === prev`）かどうか」で変更の有無を判定する。
 * 同一参照を返した場合は確定的な no-op として扱われ、state 更新・save に加えて
 * **ロード前の pendingRef へのバッファリングもスキップされる**（＝ロード後にも適用されない）。
 * そのため「今は変化が無くてもロード後に効かせたい操作」で同一参照（や引数の in-place 変更）を
 * 返してはならない。変更意図があるなら `[...items]` 等で必ず新しい参照を返すこと。
 */
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
      const prev = itemsRef.current
      const next = transform(prev)
      // transform が同一参照を返した場合は変更なしとみなし、state 更新・save をスキップする。
      // ロード前でも pendingRef に積まないため、ロード後にも適用されない確定的な no-op となる。
      // 変更意図がある transform は必ず新しい参照を返すこと（Transform<T> の JSDoc を参照）。
      if (next === prev) return
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
