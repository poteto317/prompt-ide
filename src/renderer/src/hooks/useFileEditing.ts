import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { OpenFile } from '../types'
import * as fileSystemApi from '../lib/fileSystemApi'
import { isPathAtOrInside, isSamePath, replacePathPrefix, toComparablePath } from '../lib/pathUtils'
import { useLatestRef } from './useLatestRef'

const SAVE_ABORTED_BY_FILE_OPERATION =
  'ファイル操作と重なったため保存を中止しました。もう一度保存してください。'
// 作成やリネームの移行先と重なった場合は、そのまま保存し直すと相手を潰す。
// ロックは操作の完了で解放されるため、「もう一度保存してください」では誘導が逆になる
export const SAVE_ABORTED_BY_CREATE =
  '同じ名前のファイルが作成されました。このまま保存すると、作成されたファイルを上書きします。'
// ディレクトリの場合は「上書き」ではなく書き込み自体が失敗する（EISDIR）。
// SAVE_ABORTED_BY_CREATE をそのまま使うと「ファイル」という語が不正確になる
export const SAVE_ABORTED_BY_CREATE_DIRECTORY =
  '同じ名前のディレクトリが作成されました。このまま保存すると失敗します。'
// 削除は元のパス自体を無効にするため、その配下のファイルの保存もここに来る。
// 親ごと消えているので、案内どおり再保存しても ENOENT で失敗する
export const SAVE_ABORTED_BY_DELETE =
  '削除されました。保存する場合は、フォルダを作り直してから行ってください。'
export const SAVE_ABORTED_BY_RENAME_DESTINATION =
  '同じ名前へ別のファイルがリネームされました。このまま保存すると、その内容を上書きします。'

const DISCARD_CONFIRM_MESSAGE = '保存されていない変更があります。破棄して続行しますか？'

export type ResetForFileChangeOptions = {
  /**
   * リネームの追随でパスが付け替わる場合に渡す。中止の通知は「どのパスの保存を
   * 中止したか」を持っており、この付け替えに追随したものだけを残す。
   * 渡さなければ通知は消える（別のファイルを開いた場合など、無関係なバッファの
   * 上に通知が残らないようにするため）
   */
  renamed?: { from: string; to: string }
}

export interface Options {
  onConfirm?: (message: string) => boolean
  /**
   * 同じ tick 内で確定した openFile を読むためのアクセサ。省略時は引数の openFile を
   * layout effect で追う ref を使うが、それでは同じ tick に入った編集を取りこぼす。
   * 同期ミラーを持つ呼び出し側（useFileSystem）はそれを渡すこと
   */
  getOpenFile?: () => OpenFile | null
}

interface FileEditingState {
  isDirty: boolean
  isSaving: boolean
  saveError: Error | null
  updateFileContent: (content: string) => void
  saveFile: () => Promise<void>
  resetForFileChange: (options?: ResetForFileChangeOptions) => void
  confirmDiscardIfDirty: () => boolean
  /**
   * 指定パス配下を「FS 操作中」として予約し、進行中の保存が無くなるまで待つ。
   * 戻り値を呼ぶまで、無効化の対象になったパス配下の新しい保存は書き込みを行わない。
   * 無効化の対象でない保存（作成中の同じフォルダにある別ファイルなど）は開始され、
   * isSaving は true になるが、書き込みは解放を待ってから行う。
   * 待つだけでは、待機後〜操作完了までの間に始まった保存が旧パスを再作成する
   */
  lockPathForFileOperation: (
    targetPath: string,
    options?: FileOperationLockOptions
  ) => Promise<(result?: FileOperationResult) => void>
  pendingSaveFor: (targetPath: string) => Promise<void> | null
  saveCompletionsFor: (targetPath: string) => number
}

/**
 * ロックを解放するときに、その FS 操作が成功したかを伝える。
 * 失敗した場合、その操作を理由に中止した保存の通知は取り下げる。
 * 何も起きていないのに「上書きします」と案内すると、誘導が逆になるため
 */
export type FileOperationResult = { succeeded?: boolean }

/** 無効化するパスと、その保存を中止したときに伝える文言 */
export type InvalidatedPath = { path: string; abortMessage?: string }

/**
 * FS 操作のロックの指定。
 *
 * `invalidatesPaths` は「その操作によって消える・付け替わるパス」。この配下の保存は
 * 書き込まない（待って書くと旧パスを再作成したり、移行先を上書きしたりする）。
 * `null` を渡すと、直列化はするが保存は捨てず、解放を待ってから書き込む。
 * リネームのように元と先の 2 つが無効になる操作があるため配列で受ける。
 *
 * ロックの範囲（`targetPath`）と無効化の範囲を分けているのは、リネームが親
 * ディレクトリをロックするため。移行先も同じ親の下に作られるので直列化は親単位で
 * 必要だが、無効になるのはリネーム対象自身だけで、同じフォルダの別ファイルの保存
 * まで捨ててはいけない。
 */
/**
 * FS 操作中のパスと、その完了を待つための Promise。ローカル変数やジェネリクスに
 * 依存しない純粋なデータ形状のため、他の関連型と同じくモジュールレベルに置く。
 * useFileEditing の外では使わないため export はしない
 */
type FileOperationLock = {
  path: string
  invalidatesPaths: readonly Required<InvalidatedPath>[] | null
  done: Promise<void>
}

export type FileOperationLockOptions = {
  /**
   * 文字列だけを渡すと abortMessage（未指定なら既定の文言）が使われる。
   * リネームのように「元」と「先」で危険の中身が違う場合は、パスごとに文言を指定する
   */
  invalidatesPaths?: readonly (string | InvalidatedPath)[] | null
  /** パスごとに指定しなかった場合の文言 */
  abortMessage?: string
}

export function useFileEditing(
  openFile: OpenFile | null,
  setOpenFile: Dispatch<SetStateAction<OpenFile | null>>,
  { onConfirm = confirm, getOpenFile }: Options = {}
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
  // ロックの解放を待っている間の編集を取りこぼさないために、最新の openFile を追う。
  // 待機中の 2 回目の Cmd/Ctrl+S は多重保存ガードで no-op になるため、待つ前に
  // 捕まえた内容をそのまま書くと、その間の編集が保存されない
  const openFileRef = useLatestRef(openFile)
  // useLatestRef は layout effect で更新されるため、同じ tick に入った編集を
  // 取りこぼす。同期ミラーを渡されていればそちらを読む
  const readOpenFile = (): OpenFile | null =>
    getOpenFile !== undefined ? getOpenFile() : openFileRef.current
  const [saveError, setSaveError] = useState<Error | null>(null)
  // 中止の通知が「どのパスの保存を中止したものか」。リネームの追随でだけ残すため、
  // メッセージの文字列ではなく対象で判定する
  // lock は「どの FS 操作による中止か」。操作が失敗したときに取り下げる判定に使う。
  // 取り下げ後も「保存されなかった」ことは伝え続けるため、通知自体は残す
  const saveAbortNoticeRef = useRef<{ path: string; lock: FileOperationLock | null } | null>(null)
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
  // ロックの解放を待っている保存。savingPromisesRef とは分けて持つ。
  // ロック取得側（lockPathForFileOperation）が待つのは savingPromisesRef だけで、
  // ここを見せると「保存がロックを待ち、ロックが保存を待つ」で止まってしまう。
  // 一方、読み込み側（pendingSaveFor）からは見えないと、待っている保存を
  // 無視して保存前の内容を読み直し、その編集が失われる
  const parkedSavesRef = useRef<Map<string, Promise<void>>>(new Map())

  // 1 つの保存は「待機中（parked）」か「書き込み中（in-flight）」のどちらか
  // 片方にだけ存在する。2 つの Map を呼び出しごとに手で同期させると、
  // 片方だけ更新し忘れて pendingSaveFor から見えなくなる・残り続けるといった
  // 不整合が起きるため、状態遷移をここに閉じ込める
  const saveTracking = {
    park: (path: string, promise: Promise<void>): void => {
      parkedSavesRef.current.set(path, promise)
    },
    // 待機が終わり、書き込みへ進む。ロック取得側が待つのは in-flight のみ
    promote: (path: string, promise: Promise<void>): void => {
      parkedSavesRef.current.delete(path)
      savingPromisesRef.current.set(path, promise)
    },
    clear: (path: string): void => {
      parkedSavesRef.current.delete(path)
      savingPromisesRef.current.delete(path)
    },
    // pendingSaveFor が見る範囲。待機中も含めないと、待っている保存を
    // 無視して保存前の内容を読み直してしまう
    allEntries: (): [string, Promise<void>][] => [
      ...savingPromisesRef.current.entries(),
      ...parkedSavesRef.current.entries()
    ],
    // lockPathForFileOperation が待つ範囲。待機中を含めるとデッドロックする
    inFlightEntries: (): [string, Promise<void>][] => [...savingPromisesRef.current.entries()]
  }
  // path ごとの保存の完了回数。読み込みの前後で比べると、読み込み中に
  // 始まって完了した保存(完了時点で savingPromisesRef からは消えている)を
  // 検出できる
  const saveCompletionsRef = useRef<Map<string, number>>(new Map())

  // FS 操作中のパスと、その完了を待つための Promise。
  // 無効化の対象になった配下の保存は書き込まない。対象外の保存は解放を待ってから
  // 書き込む。重なるパスの FS 操作同士も直列化する
  // 中止の通知が「どのロックによるものか」。操作が失敗したら取り下げるために持つ
  const locksRef = useRef<FileOperationLock[]>([])

  // ルートを親に持つ予約も検出できるよう isPathAtOrInside を使う。
  // isPathInside はルートを親として渡すと常に false になる
  const overlaps = (a: string, b: string): boolean =>
    isPathAtOrInside(a, b) || isPathAtOrInside(b, a)

  // その保存を無効にするロック（リネーム・削除など、対象が消える操作）
  /** その保存を無効にしている指定とロック（最初に見つかったもの）。無ければ null */
  const invalidationFor = (
    path: string
  ): { invalidated: Required<InvalidatedPath>; lock: FileOperationLock } | null => {
    for (const lock of locksRef.current) {
      if (lock.invalidatesPaths === null) continue
      const hit = lock.invalidatesPaths.find((invalidated) =>
        isPathAtOrInside(path, invalidated.path)
      )
      if (hit !== undefined) return { invalidated: hit, lock }
    }
    return null
  }

  /**
   * path が無効化されているなら、中止の通知を立てて true を返す。呼び出し側は
   * true が返ったら書き込まずに抜ける（保存を始める前とロック待ちの後、2 箇所で使う）
   */
  const abortIfInvalidated = (path: string): boolean => {
    const blocked = invalidationFor(path)
    if (blocked === null) return false
    saveAbortNoticeRef.current = { path, lock: blocked.lock }
    setSaveError(new Error(blocked.invalidated.abortMessage))
    return true
  }

  // 無効化はしないが、完了まで書き込みを待つべきロック。同じ親の下での作成や、
  // 同じフォルダにある別ファイルのリネームなど。FS 操作と書き込みが同時に走らない
  // よう、重なるロックはすべて待つ。「無効化されているか」は invalidationFor と
  // 同じ判定を使い、二重に持たない
  const blockingLocks = (path: string): FileOperationLock[] => {
    // path には依存するが lock には依存しない。ループの外で 1 回だけ求める
    const invalidatingLock = invalidationFor(path)?.lock
    return locksRef.current.filter(
      (lock) => isPathAtOrInside(path, lock.path) && invalidatingLock !== lock
    )
  }

  /**
   * targetPath 配下で進行中の保存があればその完了 promise を返す。無ければ null。
   * 読み込みのように「進行中の保存だけ待てばよい」経路で使う。null を返す形に
   * しているのは、保存が無いときに await を挟まず同期的に先へ進めるため
   * (常に await すると、読み込みの開始が 1 マイクロタスク遅れて呼び出し側の
   * 順序前提が変わる)。
   */
  const pendingSaveFor = (targetPath: string): Promise<void> | null => {
    const pending = saveTracking
      .allEntries()
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
    // 既定は安全側。指定が無ければ targetPath 配下の保存を無効にする
    {
      invalidatesPaths = [targetPath],
      abortMessage = SAVE_ABORTED_BY_FILE_OPERATION
    }: FileOperationLockOptions = {}
  ): Promise<(result?: FileOperationResult) => void> => {
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
      invalidatesPaths:
        invalidatesPaths === null
          ? null
          : invalidatesPaths.map((invalidated) =>
              typeof invalidated === 'string'
                ? { path: invalidated, abortMessage }
                : { path: invalidated.path, abortMessage: invalidated.abortMessage ?? abortMessage }
            ),
      done: new Promise<void>((resolve) => {
        releaseLock = resolve
      })
    }
    locksRef.current = [...locksRef.current, entry]
    // 予約してから待つ。予約が載っている間は、重なる保存が savingPromisesRef に
    // 登録されない（登録はロックが無くなってから行う）ので、0 件になれば以降も 0 件。
    // ただし待機の解決順によっては複数回の確認が要るためループする
    for (;;) {
      const pending = saveTracking
        .inFlightEntries()
        .filter(([path]) => isPathAtOrInside(path, targetPath))
        .map(([, promise]) => promise)
      if (pending.length === 0) break
      await Promise.all(pending)
    }
    return ({ succeeded = true }: FileOperationResult = {}) => {
      locksRef.current = locksRef.current.filter((lock) => lock !== entry)
      // 失敗したなら何も起きていない。この操作を理由にした文言は取り下げるが、
      // 「保存されなかった」こと自体は伝え続ける。消してしまうと、書き込みが
      // 落ちたことを示すものが dirty マークだけになる
      const notice = saveAbortNoticeRef.current
      if (!succeeded && notice !== null && notice.lock === entry) {
        saveAbortNoticeRef.current = { path: notice.path, lock: null }
        setSaveError(new Error(SAVE_ABORTED_BY_FILE_OPERATION))
      }
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
  const resetForFileChange = ({ renamed }: ResetForFileChangeOptions = {}): void => {
    generationRef.current += 1
    // 中止させた当のリネームが完了するとここが呼ばれる。一緒に消すと
    // 「保存されなかった」ことが伝わらないため、その付け替えに追随する通知だけ残す
    const notice = saveAbortNoticeRef.current
    const follows =
      renamed !== undefined && notice !== null && isPathAtOrInside(notice.path, renamed.from)
    if (follows && notice !== null && renamed !== undefined) {
      saveAbortNoticeRef.current = {
        ...notice,
        path: replacePathPrefix(notice.path, renamed.from, renamed.to)
      }
    } else {
      saveAbortNoticeRef.current = null
    }
    setSaveError((prev) => (follows ? prev : null))
  }

  const saveFile = async (): Promise<void> => {
    // 入口の判定も同期ミラーから読む。render 時の openFile を見ると、
    // updateFileContent の直後に saveFile を呼んだ場合（同じ tick の編集）に
    // 「未変更」と誤判定して、その編集を黙って捨てる
    const target = readOpenFile()
    if (target === null) return
    // 保存ボタンは isDirty=false のとき disabled になるが、Cmd/Ctrl+S の
    // キーボードショートカットはボタンの disabled 状態を経由せず直接 saveFile
    // を呼ぶため、未変更のファイルに対しても不要な writeFileContent(同一内容の
    // 書き込みによる mtime 更新・無駄なディスクI/O)が発生し得る。ここでも
    // ガードしておく。
    if (target.content === target.savedContent) return
    const { path, content } = target
    if (savingPathsRef.current.has(path)) return
    // リネーム・削除の実行中は書き込まない。旧パスを再作成してしまうため。
    // 保存を始める前に判定する。始めてから抜けると、書き込んでいないのに
    // 「保存が完了した」として数えられ、読み込み側が競合を誤検出する。
    // 黙って捨てるとユーザーには dirty マークしか見えないため、理由を伝える
    if (abortIfInvalidated(path)) return
    const generation = generationRef.current
    savingPathsRef.current.add(path)
    setSavingPaths(new Set(savingPathsRef.current))
    let settleSave: () => void = () => {}
    // 保存全体の完了を表す promise。待っている間は parkedSavesRef に置き、
    // 書き込みに進む時点で savingPromisesRef へ移す
    const savePromise = new Promise<void>((resolve) => {
      settleSave = resolve
    })
    saveTracking.park(path, savePromise)
    let attemptedWrite = false
    try {
      // 無効化を伴わないロック（同じフォルダでの作成、兄弟のリネームなど）は
      // 解放を待ってから書き込む。黙って捨てると保存されたように見えて内容が失われる
      for (;;) {
        const waiting = blockingLocks(path)
        if (waiting.length === 0) break
        await Promise.all(waiting.map((lock) => lock.done))
        // 待っている間にファイルが切り替わった・開き直された場合は、この保存は
        // もう画面上の編集セッションとは無関係なので書き込まない
        if (generation !== generationRef.current) return
        // 待っている間にリネーム・削除が予約されていた場合も書き込まない。
        // 「保存中」を表示したまま黙って捨てないよう、ここでも理由を伝える
        if (abortIfInvalidated(path)) return
      }
      attemptedWrite = true
      // 書き込まずに戻る経路（ロック待ちの間にファイルが入れ替わった等）が
      // あるため、エラー表示を消すのはここまで来てから。手前で消すと、
      // 何も書いていないのに前回の失敗の表示だけが消える
      saveAbortNoticeRef.current = null
      setSaveError(null)
      // 進行中の保存として登録するのはロックが無くなってから。待っている間に
      // 登録すると、ロック取得側（進行中の保存の完了を待つ）と待ち合って
      // デッドロックする
      saveTracking.promote(path, savePromise)
      // 待っている間に編集されていれば、その内容を書く。待たずに書けた場合は
      // openFile は同じなので、通常経路の挙動は変わらない
      const latest = readOpenFile()
      const contentToWrite =
        latest !== null && isSamePath(latest.path, path) ? latest.content : content
      await fileSystemApi.writeFileContent(path, contentToWrite)
      // 書き込みに使った時点の path/content/generation を捕捉しているため、
      // await 中にユーザーがさらに編集したり、別ファイルへ切り替えたり、
      // 同じファイルを開き直したりしても、savedContent には実際にディスクへ
      // 書き込んだ内容だけが、その保存が対象としていた編集セッションに
      // 限定して反映される。
      setOpenFile((prev) =>
        // 大文字小文字だけが異なる同一実体になっているケース(Windows のケースのみ
        // リネームで generation を伴わず path が変わることは無い契約だが、書き込み
        // 先の選択(isSamePath)と反映条件を揃えておく方が読み手にとって一貫する)
        prev !== null && isSamePath(prev.path, path) && generation === generationRef.current
          ? { ...prev, savedContent: contentToWrite }
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
      saveTracking.clear(path)
      if (attemptedWrite) {
        const key = toComparablePath(path)
        saveCompletionsRef.current.set(key, (saveCompletionsRef.current.get(key) ?? 0) + 1)
      }
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
