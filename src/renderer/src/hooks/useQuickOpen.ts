import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileTreeNode } from '../types'
import type { OpenedFileSignal } from './useFileSystem'
import type { QuickOpenResult } from '../lib/quickOpenSearch'
import { flattenFileTree, searchFiles } from '../lib/quickOpenSearch'
import { useLatestRef } from './useLatestRef'

/** 空クエリのときに表示する「最近開いたファイル」の最大件数 */
const MAX_RECENT_FILES = 10
/**
 * 履歴として保持するパスの最大件数。表示上限より多く持つ。
 * 保持の時点で存在確認して切り詰めると、削除・リネーム直後(ツリー更新前)の
 * 一時的に有効なパスが枠を埋め、あとから無効化されても再評価されないため、
 * 有効な履歴が欠落する。保持は素のまま行い、存在確認は表示時に行う
 */
const MAX_TRACKED_RECENT_PATHS = 50

interface Options {
  fileTree: FileTreeNode[]
  folderPath: string | null
  openFilePath: string | null
  /** ファイルを実際に開いたことを示す信号。履歴の更新契機に使う */
  openedFileSignal: OpenedFileSignal
  /** フォルダ走査に固有のエラー。ツリーが空の理由を案内するために使う */
  folderLoadError: Error | null
  /** ファイルを開けたかどうかを返す。開けなかった場合はダイアログを閉じない */
  selectFile: (node: FileTreeNode, options?: { moveFocusToEditor?: boolean }) => Promise<boolean>
}

export interface QuickOpenController {
  isOpen: boolean
  query: string
  results: QuickOpenResult[]
  activeIndex: number
  /** フォルダを開いていないときは検索対象が無い旨を UI 側で案内する */
  hasFolder: boolean
  /** 読み込み失敗でツリーが空のときのメッセージ。それ以外は null */
  loadError: string | null
  /**
   * 直近の閉じる操作が「ファイルを開いたこと」によるものか。
   * true のときにダイアログが元の要素へフォーカスを戻すと、エディタへ渡らない
   */
  hasHandedOverFocus: () => boolean
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
  openedFileSignal,
  folderLoadError,
  selectFile
}: Options): QuickOpenController {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const [rawActiveIndex, setActiveIndex] = useState(0)
  // 履歴と「どこまで処理したか」をまとめて持つ。openFilePath の変化ではなく
  // 「実際に開いた」信号で積むのは、リネームでも path が変わるため。path の変化で
  // 積むと、リネームのたびに存在しないパスが履歴の枠を埋めてしまう
  const [recent, setRecent] = useState<{ paths: string[]; lastSignalId: number }>({
    paths: [],
    lastSignalId: 0
  })
  const recentPaths = recent.paths

  const files = useMemo(() => flattenFileTree(fileTree), [fileTree])

  // useEffect ではなくレンダー中に調整するのは、effect 経由だと履歴の反映が
  // 1 フレーム遅れて再レンダーを重ねるため(React の「props 変化に合わせた state 調整」)。
  // 処理済みの信号 id を控えるので繰り返し実行されず、無限ループにはならない。
  const latestSignalId = openedFileSignal.events.at(-1)?.id ?? 0
  if (latestSignalId !== recent.lastSignalId) {
    // 未処理のイベントを古い順に積む。1 件だけ見ると、同じバッチで複数確定した
    // ときに中間のファイルが履歴から落ちる
    let paths = recent.paths
    for (const event of openedFileSignal.events.filter((e) => e.id > recent.lastSignalId)) {
      paths = [event.path, ...paths.filter((path) => path !== event.path)]
    }
    setRecent({ paths: paths.slice(0, MAX_TRACKED_RECENT_PATHS), lastSignalId: latestSignalId })
  }

  const results = useMemo(() => {
    if (query.trim().length > 0) return searchFiles(query, files, folderPath)

    // クエリが空のときは絞り込まず、最近開いたファイルを新しい順に見せる。
    // 履歴に残っていてもツリーから消えている(削除・別フォルダ)ものは除外する。
    // 現在開いているファイルも除外する。履歴の先頭は常に openFilePath のため、
    // 残すと Ctrl+P → Enter が現在のファイルの開き直しになり、未保存の編集が
    // ある場合は破棄確認から編集内容を失う経路になってしまう。
    const byPath = new Map(files.map((file) => [file.path, file]))
    // 存在確認と表示上限はここで適用する。保持側で切り詰めないことで、
    // 一時的に無効だったパスに有効な履歴が押し出されない
    const recentFiles = recentPaths
      .filter((path) => path !== openFilePath)
      .map((path) => byPath.get(path))
      .filter((file): file is NonNullable<typeof file> => file !== undefined)
      .slice(0, MAX_RECENT_FILES)
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
  // ファイルを開いて閉じた場合、フォーカスはエディタへ渡す。ダイアログが
  // 元の要素へ戻すと、エディタ側が受け取れなくなる
  const handedOverFocusRef = useRef(false)

  // 参照を安定させる。毎レンダー新しい関数だと、依存に含める側の effect が
  // 打鍵ごとに再実行され、フォーカスが外れて戻る(IME の変換が中断され得る)
  const hasHandedOverFocus = useCallback((): boolean => handedOverFocusRef.current, [])

  const startNewGeneration = useCallback((): void => {
    generationRef.current += 1
    confirmingGenerationRef.current = null
    handedOverFocusRef.current = false
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
      // 補正前の値から動かすと、候補が減った直後に表示上の位置と移動先がずれる
      setActiveIndex((activeIndex + delta + count) % count)
    },
    [results.length, activeIndex]
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
      // ダイアログは閉じるので、フォーカスはエディタへ移す
      void selectFile(target.node, { moveFocusToEditor: true })
        .then((opened) => {
          if (generation !== generationRef.current) return
          if (!opened) return
          handedOverFocusRef.current = true
          setIsOpen(false)
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
        // モーダルの Escape はここで消費する。伝播させると背後に残っている
        // コンテキストメニュー等の document ハンドラまで同時に反応してしまう
        event.stopPropagation()
        // setIsOpen(false) を直接呼ばず close() を通す。閉じる経路で必ず世代が
        // 進むようにしておき、進行中の読み込みの扱いを一箇所に揃える
        close()
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
  }, [open, close, isOpenRef])

  return {
    isOpen,
    query,
    results,
    activeIndex,
    hasFolder: folderPath !== null,
    // ツリーが空でエラーが立っている場合、空なのは検索結果 0 件だからではなく
    // 読み込みに失敗しているため。その旨を案内できるようにする
    loadError:
      folderPath !== null && files.length === 0 && folderLoadError !== null
        ? folderLoadError.message
        : null,
    hasHandedOverFocus,
    open,
    close,
    setQuery,
    moveSelection,
    setActiveIndex,
    confirm
  }
}
