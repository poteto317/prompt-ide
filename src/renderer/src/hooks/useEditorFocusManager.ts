import { useCallback, useEffect, useRef } from 'react'
import type { editor } from 'monaco-editor'
import type { OpenedFileSignal } from './useFileSystem'
import { useLatestRef } from './useLatestRef'

interface Params {
  openFilePath: string | null
  openedFileSignal: OpenedFileSignal
  /** フォーカスを持つモーダル(クイックオープン等)が開いているか */
  isOverlayOpen: boolean
}

interface EditorFocusManager {
  editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>
  /** マウントされたエディタが「現在開いているファイルのものか」を判定し、そうであれば ref を更新する。戻り値は判定結果 */
  handleEditorMount: (
    editorInstance: editor.IStandaloneCodeEditor,
    mountedFilePath: string
  ) => boolean
  focusEditorIfPending: () => void
}

// 誰もフォーカスを保持していない状態か。ダイアログやツリーなど他の要素が
// 持っているときに奪うと、入力中や操作中の場所からフォーカスが飛ぶ。
// クイックオープンから開いた場合はダイアログが消えて body に落ちるため、
// この条件で受け取れる
const isFocusUnclaimed = (): boolean => {
  const active = document.activeElement
  return active === null || active === document.body
}

// Monaco エディタへの「どのファイルへの、どのタイミングのフォーカス要求を
// 採用/破棄するか」という状態機械のみを担う。描画ロジック(EditorPanel)とは
// 責務が異なるため分離している。
export function useEditorFocusManager({
  openFilePath,
  openedFileSignal,
  isOverlayOpen
}: Params): EditorFocusManager {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const hasOpenFile = openFilePath !== null
  // フォーカス要求は「どのファイルに対する要求か」を保持する。持たないと、
  // クイックオープンで A を開いた直後に別経路で B を開いたとき、A の要求が
  // B のマウントで消費されて意図しない場所からフォーカスを奪う
  const pendingFocusPathRef = useRef<string | null>(null)
  // editorRef が保持しているインスタンスがどのファイルのものか。
  // ファイル切替直後は前のファイルのインスタンスが残っているため、これを見ないと
  // 古いインスタンスでフォーカス要求を消費してしまう
  const mountedPathRef = useRef<string | null>(null)
  // Monaco の onMount は非同期に発火するため、ハンドラ側から最新の値を読む
  const isOverlayOpenRef = useLatestRef(isOverlayOpen)
  const openFilePathRef = useLatestRef(openFilePath)

  // オーバーレイが開いている間はフォーカスを奪わない。読み込み中にクイックオープンを
  // 開き直した場合に持っていくと、続けて打った文字がファイルへ入ってしまうため。
  // エディタのマウントとオーバーレイが閉じるのはどちらが先になるか決まらないので、
  // 両方から呼んで先に条件が揃ったほうで受け取る。
  const focusEditorIfPending = useCallback((): void => {
    const requestedPath = pendingFocusPathRef.current
    // 要求したファイルと違うファイルが開かれていたら、その要求は捨てる
    if (requestedPath === null || requestedPath !== openFilePathRef.current) {
      pendingFocusPathRef.current = null
      return
    }
    if (isOverlayOpenRef.current) return
    if (!isFocusUnclaimed()) {
      // 他へ譲った時点で要求は取り下げる。残しておくと、無関係な
      // オーバーレイの開閉であとから消費され、フォーカスが飛ぶ
      pendingFocusPathRef.current = null
      return
    }
    const editorInstance = editorRef.current
    if (editorInstance === null || mountedPathRef.current !== openFilePathRef.current) return
    // 同じ path を閉じて開き直した場合、path の比較だけでは旧インスタンスと
    // 区別できない。破棄済みの Monaco はモデルを失うため、生存確認で弾く
    if (editorInstance.getModel() === null) return
    pendingFocusPathRef.current = null
    editorInstance.focus()
  }, [isOverlayOpenRef, openFilePathRef])

  // 「開いた」信号でのみ要求を立てる。openFilePath はリネームでも変わるため、
  // path の変化を使うとエクスプローラーで作業中にフォーカスを奪ってしまう
  // 信号はどの経路のオープンでも進む(履歴の更新に使うため)。フォーカス要求を
  // 立てるかは各イベントの moveFocusToEditor で決める。エクスプローラー経由は
  // false なので要求を立てず、逆に以前の要求が残っていれば取り下げる。
  // ファイルの有無の変化で立てると、エクスプローラーで最初のファイルを開いた
  // ときにも Monaco の遅延 onMount がツリーからフォーカスを奪う
  // 依存は最新イベントの id だけにする。オブジェクトの同一性に依存すると、
  // 値が同じでも再レンダーのたびに要求が立ち直り、取り下げた要求が復活する
  const latestOpenedFile = openedFileSignal.events.at(-1) ?? null
  const latestOpenedFileRef = useLatestRef(latestOpenedFile)
  useEffect(() => {
    // イベントが持つ対象パスを使う。処理時点の openFilePath を見ると、発生後に
    // 別経路で開かれたファイルを要求対象として登録してしまう
    const latest = latestOpenedFileRef.current
    if (latest === null) return
    // フォーカス移動を伴わないイベントでも、以前の要求は取り下げる。残しておくと
    // 後着の onMount がその要求を消費し、別の場所からフォーカスを奪う
    pendingFocusPathRef.current = latest.moveFocusToEditor ? latest.path : null
  }, [latestOpenedFile?.id, latestOpenedFileRef])

  // ファイルを閉じると Monaco はアンマウントされる。破棄済みのインスタンスを
  // 掴んだままだと、同じパスを開き直したときに古い側でフォーカス要求を
  // 消費してしまい、新しいエディタが入力を受け取れない
  useEffect(() => {
    if (!hasOpenFile) {
      editorRef.current = null
      mountedPathRef.current = null
      pendingFocusPathRef.current = null
      return
    }
    // 要求対象と違うファイルが開かれていたら、その要求は捨てる。信号を伴わない
    // 経路(リネーム)でも path は変わるため、ここでも破棄しておく
    if (pendingFocusPathRef.current !== null && pendingFocusPathRef.current !== openFilePath) {
      pendingFocusPathRef.current = null
    }
  }, [hasOpenFile, openFilePath])

  useEffect(() => {
    focusEditorIfPending()
  }, [openedFileSignal, isOverlayOpen, focusEditorIfPending])

  const handleEditorMount = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor, mountedFilePath: string): boolean => {
      // onMount は非同期に発火するため、素早く切り替えたときに
      // 破棄済みの古いファイルの callback が後から届くことがある。
      // 現在のファイルのものだけを保持する
      if (openFilePathRef.current !== mountedFilePath) return false
      // 破棄済みインスタンスの遅延 callback で現在の参照を壊さない
      if (editorInstance.getModel() === null) return false
      editorRef.current = editorInstance
      mountedPathRef.current = mountedFilePath
      return true
    },
    [openFilePathRef]
  )

  return { editorRef, handleEditorMount, focusEditorIfPending }
}
