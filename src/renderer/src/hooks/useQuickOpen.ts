import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileTreeNode } from '../types'
import type { QuickOpenResult } from '../lib/quickOpenSearch'
import { flattenFileTree, searchFiles } from '../lib/quickOpenSearch'
import { useLatestRef } from './useLatestRef'

/** 保持する「最近開いたファイル」の最大件数。アプリを閉じると失われるメモリ上の履歴 */
const MAX_RECENT_FILES = 10

interface Options {
  fileTree: FileTreeNode[]
  folderPath: string | null
  openFilePath: string | null
  /** ファイルを開けたかどうかを返す。開けなかった場合はダイアログを閉じない */
  selectFile: (node: FileTreeNode) => Promise<boolean>
}

export interface QuickOpenController {
  isOpen: boolean
  query: string
  results: QuickOpenResult[]
  activeIndex: number
  /** フォルダを開いていないときは検索対象が無い旨を UI 側で案内する */
  hasFolder: boolean
  open: () => void
  close: () => void
  setQuery: (query: string) => void
  /** delta 分だけ選択を移動する。両端はラップアラウンドする */
  moveSelection: (delta: number) => void
  setActiveIndex: (index: number) => void
  /** index 省略時は現在の選択を開く */
  confirm: (index?: number) => void
}

export function useQuickOpen({
  fileTree,
  folderPath,
  openFilePath,
  selectFile
}: Options): QuickOpenController {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const [rawActiveIndex, setActiveIndex] = useState(0)
  const [recentPaths, setRecentPaths] = useState<string[]>([])

  // 開いたファイルが変わるたびに履歴の先頭へ積み直す。同一パスは先に取り除いて重複を防ぐ。
  // useEffect ではなくレンダー中に調整するのは、effect 経由だと履歴の反映が
  // 1 フレーム遅れて再レンダーを重ねるため(React の「props 変化に合わせた state 調整」)。
  // 先頭が既に openFilePath なら何も起きないので無限ループにはならない。
  if (openFilePath !== null && recentPaths[0] !== openFilePath) {
    setRecentPaths(
      [openFilePath, ...recentPaths.filter((path) => path !== openFilePath)].slice(
        0,
        MAX_RECENT_FILES
      )
    )
  }

  const files = useMemo(() => flattenFileTree(fileTree), [fileTree])

  const results = useMemo(() => {
    if (query.trim().length > 0) return searchFiles(query, files, folderPath)

    // クエリが空のときは絞り込まず、最近開いたファイルを新しい順に見せる。
    // 履歴に残っていてもツリーから消えている(削除・別フォルダ)ものは除外する。
    // 現在開いているファイルも除外する。履歴の先頭は常に openFilePath のため、
    // 残すと Ctrl+P → Enter が現在のファイルの開き直しになり、未保存の編集が
    // ある場合は破棄確認から編集内容を失う経路になってしまう。
    const byPath = new Map(files.map((file) => [file.path, file]))
    const recentFiles = recentPaths
      .filter((path) => path !== openFilePath)
      .map((path) => byPath.get(path))
      .filter((file): file is NonNullable<typeof file> => file !== undefined)
    // 履歴がまだ無い初回はフォルダ内のファイルをそのまま先頭から見せる
    // (こちらの経路でも現在開いているファイルは同じ理由で除外する)
    const fallbackFiles = files.filter((file) => file.path !== openFilePath)
    return searchFiles('', recentFiles.length > 0 ? recentFiles : fallbackFiles, folderPath)
  }, [query, files, folderPath, recentPaths, openFilePath])

  // 候補の増減に追随して選択位置を有効な範囲に収める。state を書き換えるのではなく
  // 参照時に補正することで、results と activeIndex が食い違う瞬間を作らない
  const activeIndex = results.length === 0 ? 0 : Math.min(rawActiveIndex, results.length - 1)

  // selectFile の解決を待つ間ダイアログは開いたままで入力欄もフォーカスを保持する。
  // Enter のキーリピートで多重に走らせると、破棄確認が何度も出たうえ、
  // 後から解決した読み込みが表示中のファイルを上書きしてしまう。
  // 開閉のたびに世代を進め、解決した読み込みが「今の」試行のものか判定する。
  // これにより、読み込み中に閉じて開き直した場合に古い結果が新しいダイアログを
  // 閉じることも、解決しない読み込みが以降の confirm を塞ぐこともなくなる
  const generationRef = useRef(0)
  const confirmingGenerationRef = useRef<number | null>(null)

  const startNewGeneration = useCallback((): void => {
    generationRef.current += 1
    confirmingGenerationRef.current = null
  }, [])

  const open = useCallback((): void => {
    setQueryState('')
    setActiveIndex(0)
    setIsOpen(true)
    startNewGeneration()
  }, [startNewGeneration])

  const close = useCallback((): void => {
    setIsOpen(false)
    startNewGeneration()
  }, [startNewGeneration])

  const setQuery = useCallback((next: string): void => {
    setQueryState(next)
    // 候補の並びが変わるため、選択位置は毎回先頭に戻す
    setActiveIndex(0)
  }, [])

  const moveSelection = useCallback(
    (delta: number): void => {
      const count = results.length
      if (count === 0) return
      setActiveIndex((prev) => (prev + delta + count) % count)
    },
    [results.length]
  )

  const confirm = useCallback(
    (index?: number): void => {
      if (confirmingGenerationRef.current === generationRef.current) return
      const target = results[index ?? activeIndex]
      if (target === undefined) return
      const generation = generationRef.current
      confirmingGenerationRef.current = generation
      // 実際に開けたときだけ閉じる。selectFile は未保存時に破棄確認を出すため、
      // ここで先に閉じてしまうと、キャンセルされた場合にファイルは切り替わらないのに
      // ダイアログだけ消えて入力中のクエリを失う
      void selectFile(target.node)
        .then((opened) => {
          if (generation !== generationRef.current) return
          if (opened) setIsOpen(false)
        })
        .finally(() => {
          if (confirmingGenerationRef.current === generation) {
            confirmingGenerationRef.current = null
          }
        })
    },
    [results, activeIndex, selectFile]
  )

  // 開閉状態は ref 経由で読む。ハンドラのクロージャに isOpen を閉じ込めると、
  // state 更新からリスナー再登録(passive effect)までの窓で古い値が残り、
  // その間に届いた Ctrl+P を誤って握り潰してしまう。useLatestRef は
  // useLayoutEffect で更新されるため、ユーザー操作の処理前に最新化される
  const isOpenRef = useLatestRef(isOpen)

  // capture フェーズで購読する。Monaco エディタが自前の keydown ハンドラで
  // イベントを消費する場合があり、bubble フェーズだと届かないことがあるため。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // IME の変換中は一切横取りしない。変換確定の Enter や候補移動の ↑↓、
      // 変換キャンセルの Escape を奪うと、日本語入力そのものが壊れる
      if (event.isComposing) return
      // Escape も document で受ける。入力欄の onKeyDown だけに任せると、
      // 何らかの理由でフォーカスがダイアログの外へ移ったときに閉じる手段が
      // 無くなってしまう。開いていないときはエディタ側の Escape を横取りしない
      if (event.key === 'Escape') {
        if (!isOpenRef.current) return
        event.preventDefault()
        setIsOpen(false)
        return
      }
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 'p') return
      // ブラウザの印刷は常に抑止する。ただし既に表示中なら open() を呼ばない
      // (入力途中のクエリと選択位置がリセットされてしまうため)。
      // 読み込み待ちの間は例外で、ユーザーは既に選択を確定しているため開き直す。
      // ここで握り潰すと、直後にダイアログが閉じてエディタへフォーカスが移り、
      // 続けて打った文字がファイルへ入ってしまう
      event.preventDefault()
      const confirmInFlight = confirmingGenerationRef.current === generationRef.current
      if (isOpenRef.current && !confirmInFlight) return
      open()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [open, isOpenRef])

  return {
    isOpen,
    query,
    results,
    activeIndex,
    hasFolder: folderPath !== null,
    open,
    close,
    setQuery,
    moveSelection,
    setActiveIndex,
    confirm
  }
}
