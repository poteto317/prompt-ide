import { useEffect, useRef, useState } from 'react'
import type { ConflictChoice, ConflictFile, GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { toError } from '../lib/errorUtils'
import { isGitOperationDisabled } from '../lib/gitUtils'
import { joinPath } from '../lib/pathUtils'
import type { FileOperationLock } from './useFileOperationLock'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'

export type ConflictFileOperationKind = 'block' | 'whole' | 'keep' | 'remove' | 'resolve'

export interface ConflictFileOptions {
  /** 未解決ファイルの diff タブのリポジトリ相対パス(無ければ null) */
  activePath: string | null
  gitStatus: GitStatusResult | null
  refreshGitStatus: () => Promise<void>
  /** ブランチ操作・退避などと共有するロック(作業ツリーを書き換えるため lockGlobal を取る) */
  fileLock: FileOperationLock
  /** useFileSystem.hasDirtyTabAtOrInside。書き換える前に未保存編集の破棄を確認するために使う */
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
  /** useFileSystem.reloadOpenFile。書き換えたファイルのタブだけをディスクから読み直す */
  reloadOpenFile: (absolutePath: string) => Promise<void>
  /** useFileSystem.refreshTree。削除・残す・すべて採用でファイルの有無が変わり得るため、ツリーを読み直す */
  refreshTree: () => Promise<unknown>
  folderPath: string | null
  /** 未保存編集の破棄の確認ダイアログ。テストで差し替えるために注入できるようにする */
  onConfirm?: (message: string) => boolean
}

export interface ConflictFileState {
  file: ConflictFile | null
  isLoading: boolean
  error: Error | null
  pendingOperation: ConflictFileOperationKind | null
  /** 戻り値は、選択が実際に適用されたか(確認の拒否・ロック中・失敗では false) */
  chooseBlock: (index: number, choice: ConflictChoice) => Promise<boolean>
  resolveWholeFile: (side: 'ours' | 'theirs') => Promise<void>
  keepFile: () => Promise<void>
  removeFile: () => Promise<void>
  markResolved: () => Promise<void>
}

const removeConfirmMessage = (path: string): string => `${path} を削除してマージの解決にしますか？`

const DISCARD_DIRTY_MESSAGE =
  'このファイルのタブに未保存の編集があります。コンフリクトの解決で破棄されますが、続けますか？'

interface ConflictFileSetters {
  setFile: (file: ConflictFile | null) => void
  setError: (error: Error | null) => void
  setIsLoading: (loading: boolean) => void
}

// setState を呼ぶ読み込みをフック本体の外に置く(useGitStashes と同じ。react-hooks/set-state-in-effect 対策)。
// reset が true なら、読み込み前に表示中のファイルとエラーを消す(ファイルの切り替え)。
// false は操作後の読み直しで、表示を空にしない。
// keepError が true なら、読み込みの成否でエラーを変えない(失敗した操作の後の読み直しで、
// 操作のエラーの文言を残すため。読み込みに失敗したらファイルの表示だけを消す)
async function loadConflictFile(
  path: string | null,
  { reset, keepError }: { reset: boolean; keepError: boolean },
  { setFile, setError, setIsLoading }: ConflictFileSetters,
  isStale: () => boolean
): Promise<void> {
  if (reset) {
    setFile(null)
    setError(null)
  }
  if (path === null) {
    setIsLoading(false)
    return
  }
  setIsLoading(true)
  try {
    const loaded = await gitApi.getConflictFile(path)
    if (isStale()) return
    setFile(loaded)
    if (!keepError) setError(null)
  } catch (err) {
    if (isStale()) return
    setFile(null)
    if (!keepError) setError(toError(err))
  } finally {
    if (!isStale()) setIsLoading(false)
  }
}

// 解決ビュー(未解決ファイルの diff タブ)の状態と操作。useDiscardHunk / useDiscardAllChanges と同じ作りで、
// 自分の busy ref + 他の Git 操作のロック + リポジトリの有無で排他にし、ファイルを書き換える操作は
// lockGlobal を取る。ファイルを書き換える操作(ブロックの選択・ファイル全体の採用・削除)は、
// 「busy 判定 → そのファイルのタブの未保存編集の破棄確認 → ロック → 実行 → 成功時だけ
// そのタブを再読込(ファイルの有無が変わり得る操作はツリーも読み直す) → ビューの読み直し → ロック解放」の順
// (読み直しの完了までロックを握る。refreshTree はファイル操作のロックを取らないためデッドロックしない)。
// 失敗時もビューを読み直す(エラーの文言は残す)。確認の拒否ではロックを取らない。失敗時に再読込すると未保存編集が
// 失われるため、成功時だけ再読込する(パターン20)。
// 読み込みの世代(loadGenRef)は activePath・フォルダの変化で進め、遅れて解決した古い結果を捨てる
export function useConflictFile({
  activePath,
  gitStatus,
  refreshGitStatus,
  fileLock,
  hasDirtyTabAtOrInside,
  reloadOpenFile,
  refreshTree,
  folderPath,
  onConfirm = confirm
}: ConflictFileOptions): ConflictFileState {
  const [file, setFile] = useState<ConflictFile | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [pendingOperation, setPendingOperation] = useState<ConflictFileOperationKind | null>(null)
  const isRunningRef = useRef(false)
  const loadGenRef = useRef(0)
  const runOperation = useRunExclusiveGitOperation(refreshGitStatus, setError)
  const isBusy = (): boolean =>
    isRunningRef.current || fileLock.isAnyLocked() || isGitOperationDisabled(gitStatus)

  // 読み込み。世代が進んでいたら(別のファイル・フォルダへ移った)結果を反映しない
  const loadFile = (
    path: string | null,
    gen: number,
    options: { reset: boolean; keepError: boolean }
  ): Promise<void> =>
    loadConflictFile(
      path,
      options,
      { setFile, setError, setIsLoading },
      () => loadGenRef.current !== gen
    )

  useEffect(() => {
    const gen = ++loadGenRef.current
    void loadFile(activePath, gen, { reset: true, keepError: false })
    // loadFile は state セッターと ref だけに依存する(再実行の契機は activePath・folderPath のみ)
  }, [activePath, folderPath])

  const perform = async (
    kind: ConflictFileOperationKind,
    run: (path: string) => Promise<void>,
    {
      writesFile,
      rereads,
      refreshesTree = false,
      confirmMessage
    }: { writesFile: boolean; rereads: boolean; refreshesTree?: boolean; confirmMessage?: string }
  ): Promise<boolean> => {
    if (activePath === null || folderPath === null || isBusy()) return false
    const path = activePath
    const absolutePath = joinPath(folderPath, path)
    // 確認の拒否ではロックを取らない(操作の確認 -> 未保存編集の破棄の確認の順)
    if (confirmMessage !== undefined && !onConfirm(confirmMessage)) return false
    if (writesFile && hasDirtyTabAtOrInside(absolutePath) && !onConfirm(DISCARD_DIRTY_MESSAGE))
      return false
    const gen = loadGenRef.current
    // 実行中フラグ・pendingOperation・ロックは、操作の後の読み直し(タブの再読込・ビューの読み直し)が
    // 終わるまで握る。runOperation の終了(busy=false)で解放すると、読み直しの間に古いダイジェストの
    // ままブロックのボタンを押せてしまうため、解放は perform の末尾(release)で行う
    let held = false
    const release = (): void => {
      if (!held) return
      held = false
      isRunningRef.current = false
      setPendingOperation(null)
      fileLock.unlockGlobal()
    }
    try {
      const succeeded = await runOperation({
        isBusy,
        setBusy: (busy) => {
          if (!busy) return
          held = true
          isRunningRef.current = true
          setPendingOperation(kind)
        },
        onStart: fileLock.lockGlobal,
        execute: () => run(path)
      })
      // ロック中などで実行しなかった(no-op)
      if (!held) return false
      if (succeeded && writesFile) await reloadOpenFile(absolutePath)
      // ファイルの監視が無いため、削除・復元したファイルはツリーを読み直さないとエクスプローラーに反映されない。
      // ツリーの読み直しの失敗はツリー側が自身のエラー表示へ報告するため、操作の結果は変えない(useMergeState と同じ)
      if (succeeded && refreshesTree) await refreshTree().catch(() => undefined)
      // 実行中に別のファイル・フォルダへ移っていたら、読み直しは古いファイルを反映してしまうので行わない。
      // 失敗時も読み直す(照合の失敗=エディタで手で解決した・CLI で書き換えた等で、古いブロックのまま
      // 操作できなくなるのを防ぐ)。そのときは操作のエラーの文言を残す
      if ((rereads || !succeeded) && loadGenRef.current === gen) {
        const nextGen = ++loadGenRef.current
        await loadFile(path, nextGen, { reset: false, keepError: !succeeded })
      }
      return succeeded
    } finally {
      release()
    }
  }

  const chooseBlock = (index: number, choice: ConflictChoice): Promise<boolean> => {
    // 今表示しているファイルのダイジェストを渡し、main が実行時のファイルと照合する
    if (file === null || file.status !== 'parsed') return Promise.resolve(false)
    const expectedDigests = file.digests
    return perform(
      'block',
      (path) => gitApi.resolveConflictBlocks(path, expectedDigests, { [index]: choice }),
      { writesFile: true, rereads: true }
    )
  }

  const resolveWholeFile = async (side: 'ours' | 'theirs'): Promise<void> => {
    // checkout はファイルが無ければ作り直す(作業ツリーから消していた場合)ため、ツリーも読み直す
    await perform('whole', (path) => gitApi.resolveConflictWholeFile(path, side), {
      writesFile: true,
      rereads: true,
      refreshesTree: true
    })
  }

  // 「ファイルを残す」「解決済みにする」はディスクの内容を変えない(index の更新だけ)ため、
  // タブの確認・再読込は不要。解決済みになったファイルは未解決の一覧から外れるので読み直さない。
  // ただし「ファイルを残す」は作業ツリーに無いファイルを checkout で復元するため、ツリーは読み直す
  const keepFile = async (): Promise<void> => {
    await perform('keep', (path) => gitApi.keepConflictFile(path), {
      writesFile: false,
      rereads: false,
      refreshesTree: true
    })
  }

  // 削除はファイルが無くなるため、タブの再読込(読み込み失敗でタブが閉じる)とツリーの読み直しは行うが、
  // ビューの読み直しはしない
  // 解決済みの作業ツリーの内容ごと消えるため、実行前に確認を出す
  const removeFile = async (): Promise<void> => {
    if (activePath === null) return
    await perform('remove', (path) => gitApi.removeConflictFile(path), {
      writesFile: true,
      rereads: false,
      refreshesTree: true,
      confirmMessage: removeConfirmMessage(activePath)
    })
  }

  const markResolved = async (): Promise<void> => {
    await perform('resolve', (path) => gitApi.markConflictResolved(path), {
      writesFile: false,
      rereads: false
    })
  }

  return {
    file,
    isLoading,
    error,
    pendingOperation,
    chooseBlock,
    resolveWholeFile,
    keepFile,
    removeFile,
    markResolved
  }
}
