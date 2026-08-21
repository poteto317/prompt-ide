import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useLatestRef } from './useLatestRef'
import type { FileTreeNode, FileNode, OpenFile } from '../types'
import { createOpenFile } from '../lib/fileUtils'
import { isPathAtOrInside } from '../lib/pathUtils'
import * as fileSystemApi from '../lib/fileSystemApi'
import { useFileEditing } from './useFileEditing'
import type { Options } from './useFileEditing'
import { useFileTreeOperations } from './useFileTreeOperations'

/**
 * 信号に保持するイベント数。消費側が同じレンダーまで処理できないことがあるため、
 * 消費側(useQuickOpen)が追跡する履歴の上限以上を保持する必要がある。
 * 同一パスは 1 件に畳むので、この数だけ「異なるファイル」を保持できる
 */
const MAX_OPENED_FILE_EVENTS = 50

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
  openFile: OpenFile | null
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
  updateFileContent: (content: string) => void
  saveFile: () => Promise<void>
  createFile: (parentPath: string, name: string) => Promise<void>
  createDirectory: (parentPath: string, name: string) => Promise<void>
  renameEntry: (node: FileTreeNode, newName: string) => Promise<void>
  deleteEntry: (node: FileTreeNode) => Promise<void>
}

export function useFileSystem(options?: Options): FileSystemState {
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
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
  // openFile の同期ミラー。React の state はコミット後にしか読めないため、
  // 「操作の途中で確定した openFile」を同じ tick 内で参照するために持つ
  const openFileMirrorRef = useRef<OpenFile | null>(null)
  // folderPath の同期ミラー。ツリー再読込が「今どのフォルダを見ているか」を
  // 判定するために使う(クロージャの folderPath は切替後も古いままになる)
  const folderPathMirrorRef = useRef<string | null>(null)

  // openFile を更新する唯一の経路。ミラーを必ず同時に更新する。
  // 関数形式も受け付けるのは、useFileEditing が prev を基に更新するため。
  // 生の setOpenFile を渡すとミラーへ編集内容が届かず、リネーム時に古い状態を
  // 書き戻して未保存の編集を失う
  // openFile の更新はすべてここを通るため、ミラーが常に最新の確定値になる。
  // 関数形式の prev もミラーから解決することで、React のコミットを待たずに
  // 同じ tick 内で最新値を参照できる状態を保つ
  const commitOpenFile: Dispatch<SetStateAction<OpenFile | null>> = (next) => {
    const value = typeof next === 'function' ? next(openFileMirrorRef.current) : next
    openFileMirrorRef.current = value
    setOpenFile(value)
  }
  const getOpenFile = (): OpenFile | null => openFileMirrorRef.current
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
    confirmDiscardIfDirty,
    lockPathForFileOperation,
    pendingSaveFor
  } = useFileEditing(openFile, commitOpenFile, options)

  // 読み込みを待つ間に編集が入ることがある。開始時に取得した関数は当時の
  // isDirty を閉じ込めているため、コミット直前の再確認には最新のものを使う
  const confirmDiscardIfDirtyRef = useLatestRef(confirmDiscardIfDirty)
  /** 破棄確認の要否を判定するためのスナップショット(ファイルと内容の組) */
  // savedContent も含める。content と path だけだと「編集→保存→元に戻す」で
  // 変化なしと誤判定し、保存後の未保存編集を確認なしに破棄する
  type BufferSnapshot = { path: string | null; content: string | null; savedContent: string | null }
  // 同期ミラーから取る。layout effect で更新される ref だと、同じ tick に入った
  // 編集(commitOpenFile はミラーを即時更新する)を取りこぼし、未保存の変更を
  // 無確認で上書きしてしまう
  const snapshotBuffer = (): BufferSnapshot => ({
    path: openFileMirrorRef.current?.path ?? null,
    content: openFileMirrorRef.current?.content ?? null,
    savedContent: openFileMirrorRef.current?.savedContent ?? null
  })

  // 待機の前後でバッファが変わっていたら、開始時の確認はその状態を見ていない。
  // 変わっていなければ再確認しない(同じダイアログが 2 回出てしまうため)。
  // 内容だけでなく path も見るのは、別ファイルへ切り替わって偶然同じ内容に
  // なった場合に「変化なし」と誤判定しないため
  const confirmDiscardIfChangedSince = (snapshot: BufferSnapshot): boolean => {
    const now = snapshotBuffer()
    if (
      now.path === snapshot.path &&
      now.content === snapshot.content &&
      now.savedContent === snapshot.savedContent
    )
      return true
    return confirmDiscardIfDirtyRef.current()
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
    getOpenFile,
    setOpenFile: commitOpenFile,
    resetForFileChange,
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
    invalidatePendingReads: (affectedPath: string) => {
      const pending = pendingReadPathRef.current
      if (pending === null) return
      // 正規化後に同一なら isPathInside は false を返すため、完全一致を含む判定を使う。
      // Windows では大文字小文字だけ違うパスも同じ実体を指し、その読み込みが
      // 削除・リネーム後に解決すると旧パスのファイルをコミットしてしまう
      if (isPathAtOrInside(pending, affectedPath)) {
        latestReadRef.current += 1
      }
    }
  })

  const openFolder = async (): Promise<void> => {
    if (!confirmDiscardIfDirty()) return
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
    let snapshot: BufferSnapshot | null = null
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
      // フォルダを開き直すと openFile を null に戻すため、保留中の読み込みも無効化する
      // フォルダが変わるので、旧フォルダのファイルを読み込み中なら無効化する
      latestReadRef.current += 1
      committedOpenAtStart = committedOpenRef.current
      snapshot = snapshotBuffer()
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
      if (!confirmDiscardIfChangedSince(snapshot)) return
      commitOpenFile(null)
      resetForFileChange()
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
          snapshot !== null &&
          confirmDiscardIfChangedSince(snapshot)
        ) {
          commitOpenFile(null)
          resetForFileChange()
        }
      }
      const failure = err instanceof Error ? err : new Error(String(err))
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
          const failure = err instanceof Error ? err : new Error(String(err))
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
    if (!confirmDiscardIfDirty()) return false
    setError(null)
    const readId = ++latestReadRef.current
    pendingReadPathRef.current = fileNode.path
    const snapshot = snapshotBuffer()
    try {
      // 同じ path の保存が進行中なら、その完了を待ってから読む。待たないと
      // write 完了前の旧内容を読み取り、しかも再オープンで世代が進むため
      // 保存側は savedContent を更新せず、ディスクとエディタが食い違う
      for (
        let pendingSave = pendingSaveFor(fileNode.path);
        pendingSave !== null;
        pendingSave = pendingSaveFor(fileNode.path)
      ) {
        await pendingSave
      }
      const content = await fileSystemApi.readFileContent(fileNode.path)
      // 待っている間に別のファイルへ切り替わっていたら、この結果は捨てる
      if (readId !== latestReadRef.current) return false
      if (!confirmDiscardIfChangedSince(snapshot)) return false
      commitOpenFile(createOpenFile(fileNode, content))
      resetForFileChange()
      committedOpenRef.current += 1
      // 信号はどの経路でも進める(最近開いたファイルの履歴に使うため)。
      // フォーカスをエディタへ移すかは呼び出し側が決める。エクスプローラーの
      // クリックで奪うと、ツリー内のキーボード移動位置が失われるため
      setOpenedFileSignal((prev) => {
        const nextId = ++openedFileEventSeqRef.current
        // 同じパスの古いイベントは畳む。件数だけで切ると、重複を含んだ列が
        // 枠を埋めて中間の(本来保持すべき別ファイルの)履歴が落ちる
        return {
          events: [
            ...prev.events.filter((event) => event.path !== fileNode.path),
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
      setError(err instanceof Error ? err : new Error(String(err)))
      return false
    } finally {
      if (readId === latestReadRef.current) pendingReadPathRef.current = null
    }
  }

  const closeFile = (): void => {
    if (!confirmDiscardIfDirty()) return
    // 閉じたあとに保留中の読み込みが解決してファイルが再表示されるのを防ぐ
    latestReadRef.current += 1
    commitOpenFile(null)
    resetForFileChange()
  }

  return {
    folderPath,
    fileTree,
    openFile,
    openedFileSignal,
    folderLoadError,
    isDirty,
    isSaving,
    error,
    saveError,
    openFolder,
    selectFile,
    closeFile,
    updateFileContent,
    saveFile,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry
  }
}
