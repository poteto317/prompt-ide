import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { OpenFile } from '../types'
import * as fileSystemApi from '../lib/fileSystemApi'
import { isPathAtOrInside, toComparablePath } from '../lib/pathUtils'

const DISCARD_CONFIRM_MESSAGE = '保存されていない変更があります。破棄して続行しますか？'

export interface Options {
  onConfirm?: (message: string) => boolean
}

interface FileEditingState {
  isDirty: boolean
  isSaving: boolean
  saveError: Error | null
  updateFileContent: (content: string) => void
  saveFile: () => Promise<void>
  resetForFileChange: () => void
  confirmDiscardIfDirty: () => boolean
  /**
   * 指定パス配下を「FS 操作中」として予約し、進行中の保存が無くなるまで待つ。
   * 戻り値を呼ぶまで、そのパス配下の新しい保存は開始されない。
   * 待つだけでは、待機後〜操作完了までの間に始まった保存が旧パスを再作成する
   */
  lockPathForFileOperation: (
    targetPath: string,
    kind?: FileOperationLockKind
  ) => Promise<() => void>
  pendingSaveFor: (targetPath: string) => Promise<void> | null
  saveCompletionsFor: (targetPath: string) => number
}

/**
 * FS 操作のロックの種類。
 * - `mutate`: リネーム・削除など、対象のパスが消える・付け替わる操作。
 *   この間の保存は書き込まない（待って書くと旧パスを再作成してしまう）
 * - `create`: 同じ親の下に別のファイル・ディレクトリを作る操作。
 *   開いているファイル自体は壊れないため、保存は待ってから書き込む
 */
export type FileOperationLockKind = 'create' | 'mutate'

export function useFileEditing(
  openFile: OpenFile | null,
  setOpenFile: Dispatch<SetStateAction<OpenFile | null>>,
  { onConfirm = confirm }: Options = {}
): FileEditingState {
  // 保存中のファイルの path 集合を保持する。isSaving は単一の boolean ではなく
  // path の集合で判定することで、「file A の保存中に file B を保存しようとしたら
  // ブロックされる」という無関係なファイル間の干渉を防ぐ。単一スロット(直近の
  // 1件のみ)ではなく Set にしているのは、file A 保存中に file B の保存が始まり、
  // さらに file A へ戻って再度保存しようとするような複数ファイルにまたがる
  // 保存の重なりでも、各 path が独立して多重保存防止されるようにするため
  // （単一スロットだと直近の file B の情報で file A の追跡が上書きされ、
  // file A への同時書き込みを防げなくなってしまう）。
  const [savingPaths, setSavingPaths] = useState<ReadonlySet<string>>(() => new Set())
  const [saveError, setSaveError] = useState<Error | null>(null)
  const isDirty = openFile !== null && openFile.content !== openFile.savedContent
  const isSaving = openFile !== null && savingPaths.has(openFile.path)

  // 「編集セッション」の世代カウンタ。ファイルを開き直す（selectFile/openFolder
  // で新しく読み込む）、またはリネーム・祖先ディレクトリのリネームで
  // openFile.path が付け替わる（useFileTreeOperations.ts の renameEntry）
  // たびに、呼び出し側から resetForFileChange() を呼んでインクリメントして
  // もらう。同じ path のファイルを一度閉じて（保存中に破棄確認を経て）再度
  // 開き直した場合でも世代が変わるため、path 文字列だけを見て「同じ編集
  // セッション」だと誤判定しない。openFile.path が変化する経路は必ず
  // resetForFileChange() を伴うことが不変条件であり、「表示中のファイルが
  // 変わったか」の判定は generation の一致だけで完結する（別途 path を
  // 追跡する ref は不要）。
  // これを render 中に条件付きで直接代入する形で実装していたこともあったが、
  // 並行レンダリング下でコミットされないレンダーの値が残る可能性を指摘され、
  // generation への一本化でその懸念自体を無くした。
  const generationRef = useRef(0)

  // 同一ファイルへの多重保存（連打・Cmd+Sの連続入力）を同期的に防ぐ。React
  // state だけに頼ると、同一レンダー内で saveFile() が連続で呼ばれた場合に
  // setState のバッチングにより両方とも古い値を見てガードをすり抜けてしまう
  // ため、即座に反映される ref（savingPaths state と同じ内容を持つ path の
  // 集合）で判定する。同一 path が既に含まれていれば再入とみなしブロックする。
  const savingPathsRef = useRef<Set<string>>(new Set())
  // 進行中の保存の完了を待てるようにする。書き込みがリネーム・削除より後に
  // 解決すると、旧パスを再作成してファイルが復活してしまうため
  const savingPromisesRef = useRef<Map<string, Promise<void>>>(new Map())
  // path ごとの保存の完了回数。読み込みの前後で比べると、読み込み中に
  // 始まって完了した保存(完了時点で savingPromisesRef からは消えている)を
  // 検出できる
  const saveCompletionsRef = useRef<Map<string, number>>(new Map())

  // FS 操作中のパスと、その完了を待つための Promise。
  // この配下の保存は開始させず、重なるパスの FS 操作同士も直列化する
  const locksRef = useRef<{ path: string; kind: FileOperationLockKind; done: Promise<void> }[]>([])

  // ルートを親に持つ予約も検出できるよう isPathAtOrInside を使う。
  // isPathInside はルートを親として渡すと常に false になる
  const overlaps = (a: string, b: string): boolean =>
    isPathAtOrInside(a, b) || isPathAtOrInside(b, a)

  const locksCovering = (
    path: string,
    kind: FileOperationLockKind
  ): { path: string; kind: FileOperationLockKind; done: Promise<void> }[] =>
    locksRef.current.filter((lock) => lock.kind === kind && isPathAtOrInside(path, lock.path))

  /**
   * targetPath 配下で進行中の保存があればその完了 promise を返す。無ければ null。
   * 読み込みのように「進行中の保存だけ待てばよい」経路で使う。null を返す形に
   * しているのは、保存が無いときに await を挟まず同期的に先へ進めるため
   * (常に await すると、読み込みの開始が 1 マイクロタスク遅れて呼び出し側の
   * 順序前提が変わる)。
   */
  const pendingSaveFor = (targetPath: string): Promise<void> | null => {
    const pending = [...savingPromisesRef.current.entries()]
      .filter(([path]) => isPathAtOrInside(path, targetPath))
      .map(([, promise]) => promise)
    if (pending.length === 0) return null
    return Promise.all(pending).then(() => undefined)
  }

  /** targetPath に対する保存の完了回数。読み込みの前後で比較して使う */
  const saveCompletionsFor = (targetPath: string): number =>
    saveCompletionsRef.current.get(toComparablePath(targetPath)) ?? 0

  const lockPathForFileOperation = async (
    targetPath: string,
    // 既定は安全側。種類を指定しない呼び出しでは、その間の保存を行わない
    kind: FileOperationLockKind = 'mutate'
  ): Promise<() => void> => {
    // 重なる予約が残っているうちは待つ。解放のたびに取り直して確認する。
    // 待たないと、親ディレクトリの削除と子ファイルのリネームなどが並行して走る
    for (;;) {
      const conflicting = locksRef.current.filter((lock) => overlaps(lock.path, targetPath))
      if (conflicting.length === 0) break
      await Promise.all(conflicting.map((lock) => lock.done))
    }
    let releaseLock: () => void = () => {}
    const entry = {
      path: targetPath,
      kind,
      done: new Promise<void>((resolve) => {
        releaseLock = resolve
      })
    }
    locksRef.current = [...locksRef.current, entry]
    // 予約してから待つ。待機中に新しい保存は始まらないので、0 件になれば以降も 0 件。
    // ただし待機の解決順によっては複数回の確認が要るためループする
    for (;;) {
      const pending = [...savingPromisesRef.current.entries()]
        .filter(([path]) => isPathAtOrInside(path, targetPath))
        .map(([, promise]) => promise)
      if (pending.length === 0) break
      await Promise.all(pending)
    }
    return () => {
      locksRef.current = locksRef.current.filter((lock) => lock !== entry)
      releaseLock()
    }
  }

  const updateFileContent = (content: string): void => {
    setOpenFile((prev) => (prev === null ? prev : { ...prev, content }))
  }

  // ファイルを切り替えた（別ファイルを開いた・同じファイルを開き直した・
  // フォルダを開き直した）ときに、呼び出し側(useFileSystem)から明示的に
  // 呼んでもらう。世代をインクリメントし、直前の編集セッションに対する
  // 保存エラーをクリアする。これが無いと、保存に失敗したファイルから
  // 切り替えても（あるいは同じファイルを開き直しても）、無関係になった
  // 古いエラーがエディタ上に表示され続けてしまう。
  const resetForFileChange = (): void => {
    generationRef.current += 1
    setSaveError(null)
  }

  const saveFile = async (): Promise<void> => {
    if (openFile === null) return
    // 保存ボタンは isDirty=false のとき disabled になるが、Cmd/Ctrl+S の
    // キーボードショートカットはボタンの disabled 状態を経由せず直接 saveFile
    // を呼ぶため、未変更のファイルに対しても不要な writeFileContent(同一内容の
    // 書き込みによる mtime 更新・無駄なディスクI/O)が発生し得る。ここでも
    // ガードしておく。
    if (openFile.content === openFile.savedContent) return
    const { path, content } = openFile
    if (savingPathsRef.current.has(path)) return
    const generation = generationRef.current
    savingPathsRef.current.add(path)
    setSavingPaths(new Set(savingPathsRef.current))
    let settleSave: () => void = () => {}
    setSaveError(null)
    try {
      // リネーム・削除の実行中は書き込まない。旧パスを再作成してしまうため
      if (locksCovering(path, 'mutate').length > 0) return
      // 作成のロックは親ディレクトリに対して取られる。同じフォルダに別のファイルを
      // 作っているだけで開いているファイルの保存を捨てると、保存されたように見えて
      // 内容が失われるため、解放を待ってから書き込む
      for (;;) {
        const waiting = locksCovering(path, 'create')
        if (waiting.length === 0) break
        await Promise.all(waiting.map((lock) => lock.done))
        // 待っている間にファイルが切り替わった・開き直された場合は、この保存は
        // もう画面上の編集セッションとは無関係なので書き込まない
        if (generation !== generationRef.current) return
        // 待っている間にリネーム・削除が予約されていた場合も書き込まない。
        // 現状の lockPathForFileOperation は重なるロックの解放を待ってから
        // 予約するためここには来ないが、待ち合わせの仕様が変わったときに
        // 旧パスを再作成しないための保険
        if (locksCovering(path, 'mutate').length > 0) return
      }
      // 進行中の保存として登録するのはロックが無くなってから。待っている間に
      // 登録すると、ロック取得側（進行中の保存の完了を待つ）と待ち合って
      // デッドロックする
      savingPromisesRef.current.set(
        path,
        new Promise<void>((resolve) => {
          settleSave = resolve
        })
      )
      await fileSystemApi.writeFileContent(path, content)
      // 書き込みに使った時点の path/content/generation を捕捉しているため、
      // await 中にユーザーがさらに編集したり、別ファイルへ切り替えたり、
      // 同じファイルを開き直したりしても、savedContent には実際にディスクへ
      // 書き込んだ内容だけが、その保存が対象としていた編集セッションに
      // 限定して反映される。
      setOpenFile((prev) =>
        prev !== null && prev.path === path && generation === generationRef.current
          ? { ...prev, savedContent: content }
          : prev
      )
    } catch (err) {
      // 保存中に別ファイルへ切り替わっていた、または同じファイルを開き直して
      // いた場合、この保存失敗はもう画面上の編集セッションとは無関係なので
      // エラーを表示しない。
      if (generation === generationRef.current) {
        setSaveError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      savingPathsRef.current.delete(path)
      setSavingPaths(new Set(savingPathsRef.current))
      savingPromisesRef.current.delete(path)
      const key = toComparablePath(path)
      saveCompletionsRef.current.set(key, (saveCompletionsRef.current.get(key) ?? 0) + 1)
      settleSave()
    }
  }

  const confirmDiscardIfDirty = (): boolean => !isDirty || onConfirm(DISCARD_CONFIRM_MESSAGE)

  return {
    isDirty,
    isSaving,
    saveError,
    updateFileContent,
    saveFile,
    resetForFileChange,
    confirmDiscardIfDirty,
    lockPathForFileOperation,
    pendingSaveFor,
    saveCompletionsFor
  }
}
