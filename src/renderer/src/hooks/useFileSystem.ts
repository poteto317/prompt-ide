import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { FileTreeNode, FileNode, OpenFile } from '../types'
import { createOpenFile } from '../lib/fileUtils'
import { toError } from '../lib/errorUtils'
import { isPathAtOrInside, isSamePath, toComparablePath } from '../lib/pathUtils'
import * as fileSystemApi from '../lib/fileSystemApi'
import { useFileEditing, DISCARD_CONFIRM_MESSAGE } from './useFileEditing'
import type { Options } from './useFileEditing'
import { useFileTreeOperations } from './useFileTreeOperations'
import { arrayMove } from '@dnd-kit/sortable'
import { computeAdjacentItem } from './computeAdjacentItem'

/**
 * 信号に保持するイベント数。消費側が同じレンダーまで処理できないことがあるため、
 * 消費側(useQuickOpen)が追跡する履歴の上限以上を保持する必要がある。
 * 同一パスは 1 件に畳むので、この数だけ「異なるファイル」を保持できる
 */
const MAX_OPENED_FILE_EVENTS = 50
/** 読み込み中に保存が完了したときに読み直す回数の上限 */
export const MAX_READ_RETRIES = 5

export interface OpenedFileEvent {
  /** ファイルを開くたびに増える。同じファイルを開き直しても進む */
  id: number
  /** 開いたファイルのパス */
  path: string
  /** この操作でエディタへフォーカスを移すか */
  moveFocusToEditor: boolean
}

export interface OpenedFileSignal {
  /**
   * 直近に開いたファイルの列(id 昇順)。1 件だけ保持すると、同じ React バッチで
   * 複数の読み込みが確定したときに中間のファイルを取りこぼす
   */
  events: OpenedFileEvent[]
}

export interface SelectFileOptions {
  /** 開いたあとエディタへフォーカスを移すか(クイックオープン経由の場合のみ true) */
  moveFocusToEditor?: boolean
}

interface FileSystemState {
  folderPath: string | null
  fileTree: FileTreeNode[]
  /** 後方互換の算出値。アクティブなタブ(openFiles から activeFilePath で引いたもの) */
  openFile: OpenFile | null
  openFiles: OpenFile[]
  activeFilePath: string | null
  /** ファイルを開くたびに進む信号。リネームによる path 変更と区別するために使う */
  openedFileSignal: OpenedFileSignal
  /** フォルダ走査に固有のエラー。ツリーが空の理由を判定するために error と分ける */
  folderLoadError: Error | null
  isDirty: boolean
  isSaving: boolean
  error: Error | null
  saveError: Error | null
  openFolder: () => Promise<void>
  /** ファイルを開けたら true。ディレクトリ・破棄確認のキャンセル・読み込み失敗では false */
  selectFile: (node: FileTreeNode, options?: SelectFileOptions) => Promise<boolean>
  closeFile: () => void
  /** 既存タブへ切り替える。戻り値は実際に切り替わったか(開いていないパスなら false) */
  activateTab: (path: string) => boolean
  closeTab: (path: string) => void
  reorderTabs: (fromIndex: number, toIndex: number) => void
  updateFileContent: (content: string) => void
  saveFile: () => Promise<void>
  createFile: (parentPath: string, name: string) => Promise<void>
  createDirectory: (parentPath: string, name: string) => Promise<void>
  renameEntry: (node: FileTreeNode, newName: string) => Promise<void>
  deleteEntry: (node: FileTreeNode) => Promise<void>
  /** ルートからファイルツリーを読み直す。アプリ外/このフック外の要因で
   *  ディスク上のファイル構成が変わったとき(.gitignore の新規作成等)に使う */
  refreshTree: () => Promise<boolean>
  /** dirty なタブがあれば破棄確認ダイアログを出し、その結果を返す(無ければ
   *  確認せず true)。checkout 等、working tree を書き換える操作の実行前に
   *  呼び出し側が使う */
  confirmDiscardAnyDirty: () => boolean
  /** 開いている全タブのバッファをディスクの最新内容へ同期する。git checkout
   *  等、このフック外の要因(gitコマンド)で working tree のファイルが
   *  書き換わった後に呼ぶ想定。読み込みに失敗したタブ(対象ファイルが無く
   *  なった等)は閉じる */
  reloadOpenFiles: () => Promise<void>
  /** 変更の取り消し(git restore)のように、特定のファイルだけが working tree 上で
   *  書き換わった後に、そのタブだけをディスクの内容へ揃える。reloadOpenFiles と
   *  違い対象外のタブには触れない(その未保存の編集を保持するため)。呼び出し側が
   *  事前に破棄を確認する前提で、dirty も解消する。読み込みに失敗したら閉じる。
   *  開いていなければ何もしない。保存状態も無効化する(invalidateSaveStateOfTab) */
  reloadOpenFile: (absolutePath: string) => Promise<void>
  /** 指定パス自身と配下のタブを確認なしで閉じ、保存状態と保留中の読み込みを
   *  無効化する(例: 変更の取り消しでファイルをゴミ箱へ移した後)。
   *  呼び出し側が事前に破棄を確認する前提 */
  closeTabsAtOrInside: (absolutePath: string) => void
  /** そのパス自身か配下に未保存の編集があるタブがあるか */
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
}

// getOpenFile はここで常に自前の同期ミラーへ差し替える。Options（公開型）には
// getOpenFile を含めていないため、呼び出し側は最初から渡せない
export function useFileSystem(options?: Options): FileSystemState {
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  // ファイル読み込みの世代。ファイル切替が読み込み完了より先に起きても、
  // 遅れて解決した古い読み込みが表示中のファイルやエラーを上書きしないようにする。
  // (エクスプローラーの連続クリックや、クイックオープンを閉じて開き直した場合に起きる)
  const latestReadRef = useRef(0)
  // ディレクトリ読み込みの世代。ファイル側と共有すると、読み込み中にタブを閉じたり
  // ファイルをクリックしたりするだけでフォルダ選択が黙って捨てられてしまう
  const latestDirectoryReadRef = useRef(0)
  // ダイアログ試行の世代。実際の走査とは分けて数える。同じ列にすると、
  // キャンセルした試行が実行中の走査を無効化してフォルダ選択が失われる
  const dialogAttemptRef = useRef(0)
  // ツリーへの書き込み順序。フォルダ読み込みと CRUD の再読込が同じ列に並ぶことで、
  // 先に始まった読み込みの古いスナップショットが後発の結果を上書きしない
  const treeWriteSeqRef = useRef(0)
  // 実行中の openFolder 数。走査中は再読込にツリーを触らせない(権威ある結果は
  // フォルダ読み込み側が書く)
  const pendingFolderOpenRef = useRef(0)
  // 走査中に抑止した再読込があるか。最後の走査が終わった時点でやり直す
  const refreshSkippedRef = useRef(false)
  // 実際に openFile をコミットした回数。「読み込みを開始したか」ではなく
  // 「選択が確定したか」で判定するために使う(失敗・キャンセルでは進まない)
  const committedOpenRef = useRef(0)
  // 進行中のファイル読み込みの対象パス。リネーム・削除の影響範囲だけを
  // 無効化するために使う(無関係な操作で有効な選択まで捨てないため)
  const pendingReadPathRef = useRef<string | null>(null)
  // openFiles/activeFilePath の同期ミラー。React state はコミット後にしか読めないため、
  // 「操作の途中で確定した値」を同じ tick 内で参照するために持つ(既存の openFileMirrorRef と同じ理由)
  const openFilesMirrorRef = useRef<OpenFile[]>([])
  const activeFilePathMirrorRef = useRef<string | null>(null)
  // folderPath の同期ミラー。ツリー再読込が「今どのフォルダを見ているか」を
  // 判定するために使う(クロージャの folderPath は切替後も古いままになる)
  const folderPathMirrorRef = useRef<string | null>(null)

  const findFile = (files: OpenFile[], path: string | null): OpenFile | null =>
    path === null ? null : (files.find((f) => isSamePath(f.path, path)) ?? null)

  // useFileEditing へ渡す、アクティブファイルの中身だけを同期的に返す関数
  const getOpenFile = (): OpenFile | null =>
    findFile(openFilesMirrorRef.current, activeFilePathMirrorRef.current)

  // useFileEditing へ渡す唯一の更新経路。アクティブファイルの content/savedContent の
  // 更新のみを行う(null 化や新規追加はこの経路を通らない、closeTab/selectFile が別途行う)。
  // React の setState 更新関数は同じ tick 内で同期的に呼ばれるとは限らないため、
  // ミラーは「prev を updater 内で読んで書く」のではなく、常にミラー自身を prev として
  // 同期的に読み書きしてから setOpenFiles には確定済みの値を渡す(openFileMirrorRef と同じ設計)
  //
  // 関数形の更新には 2 通りの由来がある。
  // - updateFileContent: 常にアクティブなタブ自身を対象とする(入力を必ず新しい
  //   オブジェクトへ変換する。同期呼び出しなので「今のアクティブタブ」で常に正しい)
  // - saveFile の保存完了: 保存を開始した時点の path を内部で捕まえており、その
  //   path と一致しない・世代が古い入力は素通し(同一参照)で返す。保存は非同期のため、
  //   完了した時点では別のタブへ切り替わっている(が、保存対象のタブ自体はまだ
  //   openFiles に残っている)ことがある。その場合、アクティブなタブへ適用しても
  //   path 不一致で素通しされるだけで、保存対象のタブには一生反映されない。
  // どちらの由来かはここからは分からないため、まずアクティブなタブへ適用し、
  // それが素通し(同一参照)だった場合に限り、他のタブへも同じ更新関数を試す。
  // updateFileContent は素通しをしないため、この経路には来ない
  const commitOpenFile: Dispatch<SetStateAction<OpenFile | null>> = (next) => {
    const activePath = activeFilePathMirrorRef.current
    if (activePath === null) return
    const prev = openFilesMirrorRef.current
    const currentActive = findFile(prev, activePath)
    const value = typeof next === 'function' ? next(currentActive) : next
    if (value === null) return
    if (typeof next !== 'function' || value !== currentActive) {
      const nextFiles = prev.map((f) => (isSamePath(f.path, activePath) ? value : f))
      openFilesMirrorRef.current = nextFiles
      setOpenFiles(nextFiles)
      return
    }
    // アクティブなタブへの適用が素通しだった。保存を開始した時点でアクティブ
    // だった、今は非アクティブな別タブが対象の可能性があるため、他のタブでも
    // 試す。一致するタブはたかだか 1 つの想定(保存対象の path は 1 つ)なので、
    // 最初に見つかったものへ適用して抜ける
    for (const f of prev) {
      if (isSamePath(f.path, activePath)) continue
      const candidate = next(f)
      // null は「対象外」を表す既存の規約(この関数冒頭の value === null と同じ)。
      // それ以外で入力と異なる参照が返ってきたら、そのタブが更新対象だったと分かる
      if (candidate !== null && candidate !== f) {
        const nextFiles = prev.map((entry) => (entry === f ? candidate : entry))
        openFilesMirrorRef.current = nextFiles
        setOpenFiles(nextFiles)
        return
      }
    }
    // どのタブにも一致しなかった(保存対象のタブが既に閉じられているなど)。
    // 反映先が無いので何もしない
  }

  // openFiles 配列全体を更新する経路(useFileTreeOperations が使う)。更新後、
  // activeFilePath が配列から消えていたら隣接タブへ遷移する。commitOpenFile と同じ理由で、
  // ミラーへの反映と activeFilePath の補正は setOpenFiles の updater の外(同期的)に行う
  const setOpenFilesAndFixActive = (updater: (prev: OpenFile[]) => OpenFile[]): void => {
    const prev = openFilesMirrorRef.current
    const next = updater(prev)
    openFilesMirrorRef.current = next
    const activePath = activeFilePathMirrorRef.current
    if (activePath !== null) {
      const found = findFile(next, activePath)
      if (found === null) {
        const prevIndex = prev.findIndex((f) => isSamePath(f.path, activePath))
        // computeAdjacentItem は「1つの要素が削除された」ことを前提に、削除位置の
        // 要素(1つ削除後にその位置へ来る要素 = 右隣)を返す設計。ディレクトリ削除
        // (useFileTreeOperations.deleteEntry の isPathAtOrInside フィルタ)は配下の
        // 複数タブを1回の setOpenFiles 呼び出しで同時に取り除くため、prevIndex を
        // そのまま渡すと、本来隣接するはずの生き残りタブを飛び越して、さらに先の
        // タブが選ばれてしまう。
        // 要素数が変わっていない場合(リネームで自分自身の path が変わった等)は、
        // 消えたように見えた要素があった位置にそのままリネーム後の自分自身等が
        // 来ているはずなので、位置ベース(computeAdjacentItem)で返す。要素数が
        // 減っている場合のみ(削除、特にディレクトリ削除で複数タブが同時に消える
        // 場合)、prevIndex(削除された範囲の先頭)から prev を順に辿り、next に
        // まだ存在する最初のファイルを探す内容ベースの探索に切り替える
        const fallback = ((): string | null => {
          if (next.length === prev.length) return computeAdjacentItem(next, prevIndex)?.path ?? null
          if (prevIndex === -1) return next[0]?.path ?? null
          for (let i = prevIndex; i < prev.length; i++) {
            const candidate = findFile(next, prev[i].path)
            if (candidate !== null) return candidate.path
          }
          for (let i = prevIndex - 1; i >= 0; i--) {
            const candidate = findFile(next, prev[i].path)
            if (candidate !== null) return candidate.path
          }
          return null
        })()
        activeFilePathMirrorRef.current = fallback
        setActiveFilePath(fallback)
      } else if (found.path !== activePath) {
        // Windows での大文字小文字のみのリネームなど、isSamePath では同一実体でも
        // 文字列としては変わっている場合。EditorPanel/EditorTabs は activeFilePath と
        // openFiles の path を厳密な === で突き合わせるため、ここで新しい表記に
        // 揃えておかないと「見つからない」扱いになり Welcome 画面へ落ちてしまう
        activeFilePathMirrorRef.current = found.path
        setActiveFilePath(found.path)
      }
    }
    setOpenFiles(next)
  }

  // ファイルを「開いた」ことを伝える信号。リネームでも openFile.path は変わる
  // ため、path の変化だけでは open と区別できない。カウンタだけでなく対象パスも
  // 持たせるのは、受け手が信号を処理する時点で既に別のファイルへ切り替わって
  // いる可能性があるため
  const [openedFileSignal, setOpenedFileSignal] = useState<OpenedFileSignal>({ events: [] })
  // フォルダ走査に固有のエラー。error は CRUD やファイル読み込みの失敗でも立つため、
  // 「ツリーが空なのは走査に失敗したから」を判定するには分けて持つ必要がある
  const [folderLoadError, setFolderLoadError] = useState<Error | null>(null)
  // 開いたファイルのイベント ID。重複除去で末尾が入れ替わっても再利用しないよう、
  // 配列の中身ではなく専用のカウンタで採番する
  const openedFileEventSeqRef = useRef(0)
  const onConfirm = options?.onConfirm ?? confirm

  // レンダー中は ref を直接読まず、state (openFiles/activeFilePath) から算出する。
  // レンダー時点では前回のコミットで両者は一致しているため安全に使え、
  // ref を読むと再レンダーの起点にならず更新が反映されないことがある
  const activeFile = findFile(openFiles, activeFilePath)

  // フォルダ/ファイル読み込み系のエラー(error)と保存系のエラー(saveError)を分離する。
  // 同一の error を Sidebar/EditorPanel 双方に渡すと、フォルダ読み込み失敗が
  // エディタ側に「保存失敗」として表示されるなど無関係なエラーが混線するため。
  const {
    isDirty,
    isSaving,
    saveError,
    updateFileContent,
    saveFile,
    resetForFileChange,
    resetForFolderChange,
    invalidatePath,
    switchActiveFile,
    lockPathForFileOperation,
    pendingSaveFor,
    saveCompletionsFor
    // getOpenFile を渡す。layout effect で更新される ref では、同じ tick に入った
    // 編集（commitOpenFile はミラーを即時更新する）を取りこぼす
  } = useFileEditing(activeFile, commitOpenFile, { ...options, getOpenFile })

  // 全タブの中に dirty なものがあるか。フォルダ切り替えは全タブを閉じる操作なので、
  // アクティブなタブ単体ではなく開いている全タブを対象に判定する
  const hasAnyDirtyTab = (): boolean =>
    openFilesMirrorRef.current.some((f) => f.content !== f.savedContent)

  const confirmDiscardAnyDirty = (): boolean =>
    !hasAnyDirtyTab() || onConfirm(DISCARD_CONFIRM_MESSAGE)

  // 待機の前後で「dirty なタブがあるか」が変わっていたら、開始時の確認はその状態を
  // 見ていない。変わっていなければ再確認しない(同じダイアログが 2 回出てしまうため)
  const confirmDiscardChangedSinceOpenFolder = (dirtyAtStart: boolean): boolean => {
    const dirtyNow = hasAnyDirtyTab()
    if (dirtyNow === dirtyAtStart) return true
    return confirmDiscardAnyDirty()
  }

  // 指定パス配下を対象とする保留中のファイル読み込みを無効化する。リネーム・削除
  // (useFileTreeOperations)に加えて、closeTabsAtOrInside(変更の取り消し)からも
  // 同じ理由で呼ぶため、ここで一度だけ定義して両方から参照する
  const invalidatePendingReads = (affectedPath: string): void => {
    const pending = pendingReadPathRef.current
    if (pending === null) return
    // 正規化後に同一なら isPathInside は false を返すため、完全一致を含む判定を使う。
    // Windows では大文字小文字だけ違うパスも同じ実体を指し、その読み込みが
    // 削除・リネーム後に解決すると旧パスのファイルをコミットしてしまう
    if (isPathAtOrInside(pending, affectedPath)) {
      latestReadRef.current += 1
    }
  }

  // ファイル操作CRUD(作成/リネーム/削除)と、開いているファイルへの追随ロジックは
  // useFileTreeOperations に委譲する。fileTree/error の状態もそちらが保持する。
  const {
    fileTree,
    setFileTree,
    error,
    setError,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    refreshTree
  } = useFileTreeOperations({
    getOpenFiles: () => openFilesMirrorRef.current,
    setOpenFiles: setOpenFilesAndFixActive,
    getActiveFilePath: () => activeFilePathMirrorRef.current,
    resetForFileChange,
    invalidatePath,
    onConfirm,
    // リネーム・削除の対象が読み込み中のファイルなら、その結果を表示しないようにする。
    // (削除済みファイルを表示すると、編集して保存した時点で復活してしまう)
    // 影響範囲外の読み込みまで捨てると、無関係な操作で有効な選択を失う
    // ツリー再読込は「今のフォルダ」を同期的に見て判断する。世代カウンタでは、
    // 切替後に始まった古い CRUD の再読込が新しい世代を取得してしまい、
    // 旧フォルダのツリーやエラーが新しいフォルダへ反映されてしまう
    getFolderPath: () => folderPathMirrorRef.current,
    // ツリーへの書き込みを開始する。フォルダ走査中は書き込ませない(null)。
    // 返る関数は「自分がまだ最新の書き込みか」を返す
    beginTreeWrite: () => {
      if (pendingFolderOpenRef.current > 0) {
        // 走査中は書かせないが、取りこぼさないよう「抑止した」ことを記録する
        refreshSkippedRef.current = true
        return null
      }
      const seq = ++treeWriteSeqRef.current
      return () => seq === treeWriteSeqRef.current && pendingFolderOpenRef.current === 0
    },
    // リネーム・削除は、対象の保存が終わってから行う。書き込みが後に解決すると
    // 旧パスを再作成してしまい、削除したファイルが復活する
    lockPathForFileOperation,
    reportTreeLoad: (loadError) => setFolderLoadError(loadError),
    invalidatePendingReads
  })

  const openFolder = async (): Promise<void> => {
    if (!confirmDiscardAnyDirty()) return
    // ダイアログの表示前に試行の世代を割り当てる。解決後だと、ダイアログが
    // reject した時点で「最新の試行か」を判定できず、後続のフォルダ選択が
    // 確定したあとに先行操作のエラーで上書きしてしまう
    const dialogAttemptId = ++dialogAttemptRef.current
    // 走査の世代。実際に走査へ入ってから割り当てる
    let directoryReadId: number | null = null
    // ネイティブダイアログは長時間開いたままになり得る。その間まで再読込を
    // 止めると、キャンセル時に捨てた再読込が復元されずツリーが古いまま残るため、
    // 実際の走査に入ってから止める
    let scanning = false
    // ダイアログで選択されたフォルダ。main は選択直後にアクセス範囲を
    // このフォルダへ切り替えるため、走査に失敗しても表示を合わせる必要がある
    let selectedPath: string | null = null
    // 失敗経路でも成功経路と同じ判定を行うため、走査開始時点の状態を控える
    let committedOpenAtStart: number | null = null
    let dirtyAtStart: boolean | null = null
    try {
      const path = await fileSystemApi.openFolder()
      // 先行ダイアログが後発の選択より遅れて返ることがある。古い試行のまま
      // 進むと、走査の世代を進めて後発の結果を捨て、古いフォルダが最終表示になる
      if (dialogAttemptId !== dialogAttemptRef.current) return
      if (path === null) return
      // キャンセル時に現在のエラーを消さないよう、パスが返ってからクリアする
      setError(null)
      setFolderLoadError(null)
      pendingFolderOpenRef.current += 1
      scanning = true
      selectedPath = path
      directoryReadId = ++latestDirectoryReadRef.current
      // フォルダを開き直すと openFiles を空に戻すため、保留中の読み込みも無効化する
      // フォルダが変わるので、旧フォルダのファイルを読み込み中なら無効化する
      latestReadRef.current += 1
      committedOpenAtStart = committedOpenRef.current
      dirtyAtStart = hasAnyDirtyTab()
      const treeWriteSeq = ++treeWriteSeqRef.current
      const tree = await fileSystemApi.readDirectory(path)
      // より新しいフォルダ選択が始まっていたら、こちらの結果は捨てる
      if (directoryReadId !== latestDirectoryReadRef.current) return
      // フォルダ選択そのものは必ず確定させる。ここを中断すると、読み込み中の
      // ファイル操作だけでフォルダ選択が黙って捨てられてしまう
      folderPathMirrorRef.current = path
      setFolderPath(path)
      // より新しい読み込みが既にツリーを書いていたら、それを古い内容で潰さない
      if (treeWriteSeq === treeWriteSeqRef.current) setFileTree(tree)
      // 走査中に立ったエラー(旧フォルダの読み込み失敗など)を新しい画面に残さない
      setError(null)
      setFolderLoadError(null)
      // 待つ間に「確定した」ファイル選択があれば、その結果を消さない。
      // 読み込みの開始ではなくコミット回数で見るのは、失敗・キャンセルした
      // 読み込みで旧フォルダのファイルが残ってしまうのを防ぐため
      // 走査中に始まってまだコミットしていない読み込みを無効化する。旧フォルダの
      // ファイルなので、この後どの分岐へ進んでも捨てる。分岐の後に置くと、
      // 早期 return する経路で無効化に到達せず、その読み込みが新しいフォルダに
      // 旧フォルダのファイルを表示したり、再確認なしにバッファを置き換えたりする
      latestReadRef.current += 1
      if (committedOpenRef.current !== committedOpenAtStart) return
      // ディレクトリ走査は秒単位になり得る。その間に入った編集は開始時の確認が
      // 見ていないため、閉じる前にあらためて確認する。キャンセルされた場合は
      // フォルダとツリーだけ確定し、ファイルは開いたまま残す
      if (!confirmDiscardChangedSinceOpenFolder(dirtyAtStart)) return
      // クリアする前の全タブを控える。フォルダを開き直すと openFiles を丸ごと
      // 空にするため、それまで開いていた全タブの保存セッションを無効化する必要が
      // ある(参照している path が無くなる各タブ個別にではなく、まとめて 1 回で行う)
      const pathsBeingCleared = openFilesMirrorRef.current.map((f) => f.path)
      setOpenFilesAndFixActive(() => [])
      activeFilePathMirrorRef.current = null
      setActiveFilePath(null)
      resetForFolderChange(pathsBeingCleared)
    } catch (err) {
      // 後発の操作が確定したあとに古い読み込みが失敗しても、現在の状態を汚さない。
      // 走査前(ダイアログ段階)の失敗は試行の世代で、走査後は走査の世代で判定する
      const superseded =
        directoryReadId === null
          ? dialogAttemptId !== dialogAttemptRef.current
          : directoryReadId !== latestDirectoryReadRef.current
      if (superseded) return
      // 選択済みなら、走査に失敗してもフォルダは確定させる。旧フォルダのツリーを
      // 残すと、アクセス範囲は新しいフォルダなのに表示だけ古いという不一致になり、
      // 以降の保存・再読込・CRUD がすべてアクセス拒否になる
      if (selectedPath !== null) {
        folderPathMirrorRef.current = selectedPath
        setFolderPath(selectedPath)
        setFileTree([])
        // 成功経路と同様、走査中に始まった読み込みは旧フォルダのものなので捨てる
        latestReadRef.current += 1
        // 旧フォルダのファイルを開いたままにすると、アクセス範囲は選択先なのに
        // 保存・再読込が不整合になる。成功経路と同じ判定で閉じる
        if (
          committedOpenAtStart !== null &&
          committedOpenRef.current === committedOpenAtStart &&
          dirtyAtStart !== null &&
          confirmDiscardChangedSinceOpenFolder(dirtyAtStart)
        ) {
          const pathsBeingCleared = openFilesMirrorRef.current.map((f) => f.path)
          setOpenFilesAndFixActive(() => [])
          activeFilePathMirrorRef.current = null
          setActiveFilePath(null)
          resetForFolderChange(pathsBeingCleared)
        }
      }
      const failure = toError(err)
      setError(failure)
      // 走査まで到達していた失敗だけを走査エラーとして扱う
      if (selectedPath !== null) setFolderLoadError(failure)
    } finally {
      if (scanning) pendingFolderOpenRef.current -= 1
      // 走査中に抑止した再読込を、すべての走査が終わった時点でやり直す。
      // 走査が失敗・キャンセルした経路でも必要。並行する走査があるうちは
      // まだ抑止されるため、最後の 1 本が終わったときにだけ実行する。
      // ここでの失敗は openFolder を reject させず、同じエラー表示へ流す
      if (pendingFolderOpenRef.current === 0 && refreshSkippedRef.current) {
        refreshSkippedRef.current = false
        try {
          // 実際に現在のツリーへ反映した場合だけエラーを消す。stale で何も
          // 反映しなかった取り直しで、後発のフォルダのエラーを消してしまわない
          const applied = await refreshTree()
          if (applied) setError(null)
        } catch (err) {
          const failure = toError(err)
          setError(failure)
          // ツリーが空のままになるため、クイックオープン等が理由を案内できるよう
          // 走査エラーとしても扱う
          setFolderLoadError(failure)
        }
      }
    }
  }

  // 呼び出し側が「実際に開けたか」で分岐できるよう成否を返す。クイックオープンは
  // 開けなかったとき(破棄確認のキャンセルなど)にダイアログを閉じずに残す。
  const selectFile = async (node: FileTreeNode, options?: SelectFileOptions): Promise<boolean> => {
    if (node.type !== 'file') return false
    // TypeScript resets property narrowing after `await`; capture the narrowed type here.
    const fileNode = node as FileNode
    // 既に開いているタブなら、新規タブを作らずアクティブ化するだけでよい。
    // 別タブへの切り替えは既存タブの内容を破棄しないため、確認は不要
    const existing = findFile(openFilesMirrorRef.current, fileNode.path)
    if (existing !== null) {
      activeFilePathMirrorRef.current = fileNode.path
      setActiveFilePath(fileNode.path)
      // 既存タブへのアクティブ切り替えであり、バッファは破棄されないため
      // generation は進めない(進行中の保存を誤って無効扱いにしないため)
      switchActiveFile()
      setOpenedFileSignal((prev) => {
        const nextId = ++openedFileEventSeqRef.current
        const openedKey = toComparablePath(fileNode.path)
        return {
          events: [
            ...prev.events.filter((event) => toComparablePath(event.path) !== openedKey),
            {
              id: nextId,
              path: fileNode.path,
              moveFocusToEditor: options?.moveFocusToEditor === true
            }
          ].slice(-MAX_OPENED_FILE_EVENTS)
        }
      })
      return true
    }
    setError(null)
    const readId = ++latestReadRef.current
    pendingReadPathRef.current = fileNode.path
    try {
      // 同じ path の保存が進行中なら、その完了を待ってから読む。待たないと
      // write 完了前の旧内容を読み取り、しかも再オープンで世代が進むため
      // 保存側は savedContent を更新せず、ディスクとエディタが食い違う
      // 読み込み中に始まって完了した保存も取りこぼさない。完了した保存は
      // pendingSaveFor から消えるため、完了回数を読み込みの前後で比べて
      // 変化していれば読み直す。保存は利用者の操作なので通常は 1 回で収束するが、
      // 連打された場合に回り続けないよう試行回数に上限を設ける
      let content: string | null = null
      for (let attempt = 0; attempt <= MAX_READ_RETRIES; attempt++) {
        for (
          let pendingSave = pendingSaveFor(fileNode.path);
          pendingSave !== null;
          pendingSave = pendingSaveFor(fileNode.path)
        ) {
          await pendingSave
        }
        const completionsBeforeRead = saveCompletionsFor(fileNode.path)
        const readContent = await fileSystemApi.readFileContent(fileNode.path)
        if (readId !== latestReadRef.current) return false
        // 読み込み中に保存が完了した場合(完了回数の変化)に加え、解決時点でまだ
        // 進行中の保存が残っている場合も読み直す。どちらも読み取った内容が
        // 保存前のものになり得る
        if (
          saveCompletionsFor(fileNode.path) === completionsBeforeRead &&
          pendingSaveFor(fileNode.path) === null
        ) {
          content = readContent
          break
        }
      }
      // 上限まで競合が続いた場合、古いと分かっている内容はコミットしない。
      // clean として表示するとディスクとの食い違いに気付けなくなる
      if (content === null) {
        setError(new Error('保存と競合したため読み込めませんでした。もう一度開いてください。'))
        return false
      }
      // 待っている間に別のファイルへ切り替わっていたら、この結果は捨てる
      if (readId !== latestReadRef.current) return false
      // 新規タブとして追加する。既存タブは破棄しないため、ここで破棄確認は不要
      setOpenFilesAndFixActive((prev) => [...prev, createOpenFile(fileNode, content)])
      activeFilePathMirrorRef.current = fileNode.path
      setActiveFilePath(fileNode.path)
      resetForFileChange(fileNode.path)
      committedOpenRef.current += 1
      // 信号はどの経路でも進める(最近開いたファイルの履歴に使うため)。
      // フォーカスをエディタへ移すかは呼び出し側が決める。エクスプローラーの
      // クリックで奪うと、ツリー内のキーボード移動位置が失われるため
      setOpenedFileSignal((prev) => {
        const nextId = ++openedFileEventSeqRef.current
        // 同じパスの古いイベントは畳む。件数だけで切ると、重複を含んだ列が
        // 枠を埋めて中間の(本来保持すべき別ファイルの)履歴が落ちる。
        // Windows では表記だけ違うパスも同じファイルなので正規化して比較する
        const openedKey = toComparablePath(fileNode.path)
        return {
          events: [
            ...prev.events.filter((event) => toComparablePath(event.path) !== openedKey),
            {
              id: nextId,
              path: fileNode.path,
              moveFocusToEditor: options?.moveFocusToEditor === true
            }
          ].slice(-MAX_OPENED_FILE_EVENTS)
        }
      })
      return true
    } catch (err) {
      if (readId !== latestReadRef.current) return false
      setError(toError(err))
      return false
    } finally {
      if (readId === latestReadRef.current) pendingReadPathRef.current = null
    }
  }

  // 戻り値は「実際に切り替わったか」。呼び出し元(useAppState の diff タブ
  // 非アクティブ化ラッパー)がこれを見ないと、開いていないパスを渡されたときに
  // 実ファイルタブは変わらないのに diff タブだけ非アクティブになり、
  // どちらも表示されない状態になってしまう
  const activateTab = (path: string): boolean => {
    if (findFile(openFilesMirrorRef.current, path) === null) return false
    activeFilePathMirrorRef.current = path
    setActiveFilePath(path)
    // 既存タブ間の切り替えであり、バッファは破棄されないため generation は
    // 進めない(進行中の保存を誤って無効扱いにしないため)
    switchActiveFile()
    return true
  }

  const closeTab = (path: string): void => {
    const target = findFile(openFilesMirrorRef.current, path)
    if (target === null) return
    if (target.content !== target.savedContent && !onConfirm(DISCARD_CONFIRM_MESSAGE)) return
    // wasActive は setOpenFilesAndFixActive を呼ぶ前の状態で判定する。呼んだ後だと
    // activeFilePathMirrorRef が既に隣接タブへ書き換わっており、閉じたタブが
    // アクティブだったかどうかを判定できなくなる
    const wasActive = isSamePath(activeFilePathMirrorRef.current ?? '', path)
    // 閉じたあとに保留中の読み込みが解決してファイルが再表示されるのを防ぐ。
    // アクティブでないタブの保留中読み込みまで無効化すると、無関係な操作で
    // 別タブの選択が失われる
    if (
      wasActive &&
      pendingReadPathRef.current !== null &&
      isSamePath(pendingReadPathRef.current, path)
    ) {
      latestReadRef.current += 1
    }
    setOpenFilesAndFixActive((prev) => prev.filter((f) => !isSamePath(f.path, path)))
    // アクティブファイルの識別子が変わったときだけ resetForFileChange を呼ぶ。
    // generation が path キーの Map になった後も、この gate 自体は残す必要がある。
    // resetForFileChange は generation の他に clearStaleSaveState(グローバルな
    // saveError/中止通知のクリア)も行うため、閉じたタブがアクティブでない場合に
    // 呼んでしまうと、閉じたタブとは無関係な「現在アクティブな別タブ」の
    // saveError まで誤って消してしまう(saveError は path キーではなく単一値の
    // ままなので、per-path 化の恩恵を受けない)。閉じたタブ自身の保存中バッファは
    // wasActive に関わらずどのみち openFiles から破棄されるため、閉じたタブの
    // 世代を進める安全上の必要性も無い。
    if (wasActive) resetForFileChange(path)
  }

  // commitOpenFile/setOpenFilesAndFixActive と同じ理由(React の setState 更新関数は
  // 同じ tick 内で同期的に呼ばれるとは限らない)で、ミラーへの反映は updater の外で
  // 同期的に行い、setOpenFiles には確定済みの配列を渡す
  //
  // 呼び出し元(EditorTabs.tsx の handleDragEnd)が「並び替え可能なタブ
  // (isReorderable=true の実ファイルタブ)だけ」のインデックス空間へ変換してから
  // 渡してくるため、ここへ来る値は openFiles と同じ索引を指す。以前は結合
  // タブバー上のインデックスがそのまま渡っており、diff タブが絡むドラッグが
  // 下のガードで無言の no-op になっていた(ユーザーからは「ドラッグできるのに
  // 何も起きない」だけが見えていた)。ガード自体は、呼び出し元の変換漏れで
  // 範囲外の値が来ても配列を壊さないための最後の防波堤として残す
  const reorderTabs = (fromIndex: number, toIndex: number): void => {
    const prev = openFilesMirrorRef.current
    if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) {
      return
    }
    const next = arrayMove(prev, fromIndex, toIndex)
    openFilesMirrorRef.current = next
    setOpenFiles(next)
  }

  const closeFile = (): void => {
    const activePath = activeFilePathMirrorRef.current
    if (activePath === null) return
    closeTab(activePath)
  }

  // git checkout はこのフックを経由せず working tree のファイルを直接書き換える。
  // 開いている全タブを対象に、失敗したものは除外(閉じる)しつつディスクの最新
  // 内容へ揃える。content/savedContent を同じ値で更新することで dirty 状態も
  // リセットする(呼び出し側が事前に confirmDiscardAnyDirty で破棄を確認する)。
  // selectFile の保存待ち・世代管理のような厳密な競合制御は行わない
  // (checkout 実行中は他の保存系操作もほぼ発生しない想定のため)
  const reloadOpenFiles = async (): Promise<void> => {
    const targets = openFilesMirrorRef.current
    if (targets.length === 0) return
    const results = await Promise.all(
      targets.map(async (f) => {
        try {
          return {
            path: f.path,
            content: await fileSystemApi.readFileContent(f.path),
            ok: true as const
          }
        } catch {
          return { path: f.path, ok: false as const }
        }
      })
    )
    setOpenFilesAndFixActive((prev) =>
      prev.flatMap((f) => {
        const result = results.find((r) => isSamePath(r.path, f.path))
        if (result === undefined || !result.ok) return []
        return [{ ...f, content: result.content, savedContent: result.content }]
      })
    )
  }

  // 外部要因(変更の取り消し)でバッファが置き換わった、または閉じられたタブの保存状態を
  // 無効化する。deleteEntry/closeTab と同じゲートを reloadOpenFile/closeTabsAtOrInside で
  // 共有するために切り出した:
  // - アクティブなタブだった場合だけ resetForFileChange(generation に加えて
  //   saveError/saveAbortNoticeRef のクリア = clearStaleSaveState を伴う)を呼ぶ
  // - それ以外は invalidatePath(generation のみ)にとどめる。非アクティブなタブへの操作で
  //   clearStaleSaveState まで呼ぶと、今アクティブな別タブに表示中のエラー・中止通知を
  //   無関係な取り消しで誤って消してしまう
  // generation を進めないと、この path を対象に待機中だった保存(lockPathForFileOperation
  // 待ち等)が取り消し後に解決し、復元した内容を上書きしたり、ゴミ箱へ移したファイルを
  // 書き込みで作り直したりしてしまう
  const invalidateSaveStateOfTab = (path: string, activePath: string | null): void => {
    if (activePath !== null && isSamePath(path, activePath)) {
      resetForFileChange(path)
    } else {
      invalidatePath(path)
    }
  }

  // 契約は FileSystemState の JSDoc を参照。
  // 読み込み中(readFileContent の await 中)にエディタへ入力された編集は、
  // 完了時にディスクの内容で上書きされる(reloadOpenFiles と同じ、許容している
  // トレードオフ。selectFile のような世代付き排他制御までは行わない)
  const reloadOpenFile = async (absolutePath: string): Promise<void> => {
    if (!openFilesMirrorRef.current.some((f) => isSamePath(f.path, absolutePath))) return
    let content: string | null = null
    try {
      content = await fileSystemApi.readFileContent(absolutePath)
    } catch {
      content = null
    }
    // アクティブかどうかは setOpenFilesAndFixActive を呼ぶ前の状態で判定する(closeTab と
    // 同じ理由)。呼んだ後だと、読み込み失敗でタブが閉じられてアクティブが隣接
    // タブへ移った場合に、対象タブがアクティブだったかどうかを判定できなくなる
    const activePath = activeFilePathMirrorRef.current
    // 保留中の読み込み(pendingReadPathRef)は無効化しない。selectFile がそれを
    // 立てるのは「まだ開いていないパス」を開くときだけで、このタブは開いているため
    // 同じパスの保留中の読み込みは存在しない。reload の待機中にユーザーがタブを閉じて
    // 開き直した場合、その読み込みは正当なものなので無効化してはならない
    // (closeTabsAtOrInside はタブを閉じるため、閉じたパス配下を開こうとしている
    // 読み込みを無効化する必要がある点で異なる)
    setOpenFilesAndFixActive((prev) =>
      prev.flatMap((f) => {
        if (!isSamePath(f.path, absolutePath)) return [f]
        return content === null ? [] : [{ ...f, content, savedContent: content }]
      })
    )
    // このタブのバッファ実体はディスクの内容で置き換わった(読み込み失敗時は
    // 閉じられ、元のバッファはもう存在しない)ため、保存状態を無効化する
    invalidateSaveStateOfTab(absolutePath, activePath)
  }

  // invalidatePendingReads は「まだタブとして確定していない、進行中の読み込み」を
  // 対象にするため、affected(既に開いているタブ)が 0 件でも必ず呼ぶ。ここを
  // affected.length === 0 の早期リターンより後に置くと、選択中(未確定)の読み込みを
  // 取りこぼし、対象パス配下を後から開き直してしまう
  const closeTabsAtOrInside = (absolutePath: string): void => {
    const activePath = activeFilePathMirrorRef.current
    const affected = openFilesMirrorRef.current.filter((f) =>
      isPathAtOrInside(f.path, absolutePath)
    )
    invalidatePendingReads(absolutePath)
    if (affected.length === 0) return
    setOpenFilesAndFixActive((prev) => prev.filter((f) => !isPathAtOrInside(f.path, absolutePath)))
    affected.forEach((f) => invalidateSaveStateOfTab(f.path, activePath))
  }

  const hasDirtyTabAtOrInside = (absolutePath: string): boolean =>
    openFilesMirrorRef.current.some(
      (f) => isPathAtOrInside(f.path, absolutePath) && f.content !== f.savedContent
    )

  return {
    folderPath,
    fileTree,
    openFile: activeFile,
    openFiles,
    activeFilePath,
    openedFileSignal,
    folderLoadError,
    isDirty,
    isSaving,
    error,
    saveError,
    openFolder,
    selectFile,
    closeFile,
    activateTab,
    closeTab,
    reorderTabs,
    updateFileContent,
    saveFile,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    refreshTree,
    confirmDiscardAnyDirty,
    reloadOpenFiles,
    reloadOpenFile,
    closeTabsAtOrInside,
    hasDirtyTabAtOrInside
  }
}
