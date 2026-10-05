import { useEffect, useRef } from 'react'
import type { ExternalChangeKind } from '@shared/types'
import type { OpenFile } from '../types'
import * as fileSystemApi from '../lib/fileSystemApi'
import { toComparablePath } from '../lib/pathUtils'
import { decideExternalChange } from '../lib/externalChangeDecision'
import type { ExternalChangeFallback, NotifiedDisk } from '../lib/externalChangeDecision'
import { createKeyedCoalescer } from '../lib/keyedCoalescer'
import type { KeyedCoalescer } from '../lib/keyedCoalescer'
import { useLatestRef } from './useLatestRef'
import type { ExternalChangeMarks } from './useExternalChangeMarks'

// 開いているタブの外部変更の反映(設計書「未編集のタブの自動の再読込と、編集中のタブへの通知」)。main の監視の通知と、
// ウィンドウのフォーカスの復帰・再表示(監視の取りこぼし、symlink のリンク先の変更などの補助)で、ディスクとタブの
// savedContent を比べる。イベントの種類では判定しない

export const EXTERNAL_RELOAD_CONFIRM_MESSAGE =
  '保存されていない変更は失われます。ディスクの内容を読み込みますか？'

export interface ExternalChangeBannerState {
  path: string
  kind: ExternalChangeKind
  /** ディスクの内容を読み込む(確認の後)。modified のときだけ */
  reload: (() => void) | null
  /** 印を消してこのまま編集する(保存の照合は引き続き働く) */
  dismiss: () => void
}

export interface UseExternalFileChangesOptions {
  openFiles: OpenFile[]
  activeFilePath: string | null
  /** ファイルのタブを表示しているか(diff タブの表示中は通知を出さない) */
  isFileTabActive: boolean
  getOpenFileSnapshot: (path: string) => OpenFile | null
  waitForPendingSave: (path: string) => Promise<void>
  replaceCleanTabWithDisk: (
    path: string,
    expected: { content: string; savedContent: string },
    disk: string | null
  ) => boolean
  reloadOpenFile: (path: string) => Promise<void>
  marks: ExternalChangeMarks
  /**
   * 開いているフォルダ。main はフォルダが変わると監視をすべて閉じるため、変わったら(タブの一覧が同じでも)監視の対象を
   * 送り直す(走査の間にファイルを開いた・未保存の確認でキャンセルしたときは、フォルダを切り替えてもタブが残る)
   */
  folderPath?: string | null
  onConfirm?: (message: string) => boolean
}

// 開いているタブのパスを 1 つの文字列にする(effect の依存を値で比べるため)。パスに改行は入らない
const PATH_SEPARATOR = '\n'

// 読む間に保存が挟まった(savedContent が変わった)ときに読み直す回数の上限。保存が続いても確認が終わらなくならないように
const MAX_CHECK_ATTEMPTS = 3

export function useExternalFileChanges({
  openFiles,
  activeFilePath,
  isFileTabActive,
  getOpenFileSnapshot,
  waitForPendingSave,
  replaceCleanTabWithDisk,
  reloadOpenFile,
  marks,
  folderPath = null,
  onConfirm = confirm
}: UseExternalFileChangesOptions): ExternalChangeBannerState | null {
  const openPathsRef = useLatestRef(openFiles.map((file) => file.path))
  const pathsKey = openFiles.map((file) => file.path).join(PATH_SEPARATOR)
  // 破棄の後に読み終えた確認は何もしない
  const disposedRef = useRef(false)
  // 印を付けたときのディスクの内容(比較用のキーごと)。dismiss で dismissedRef へ移す
  const notifiedRef = useRef(new Map<string, NotifiedDisk>())
  // 「このまま編集する」で消した変更。同じディスクの内容のままなら知らせ直さない(フォーカスの復帰のたびに出直さない)。
  // 保存・再読込で savedContent が変わった、ディスクが savedContent に戻った、タブを閉じたら捨てる
  const dismissedRef = useRef(new Map<string, NotifiedDisk>())

  // 1 つのパスを確かめる(設計書の 1〜6。判定は decideExternalChange)。購読は張り直さず、最新の描画の関数を ref 経由で呼ぶ
  const check = async (path: string): Promise<void> => {
    for (let attempt = 0; attempt < MAX_CHECK_ATTEMPTS; attempt++) {
      // 自分の保存を外部変更と誤認しない(保存の後は savedContent がディスクと同じになる)
      await waitForPendingSave(path)
      if (disposedRef.current) return
      // 置き換えの控え(expected)は、読む前に取った時点の内容。未編集のときだけ置き換えに渡す
      const before = getOpenFileSnapshot(path)
      if (before === null) return
      let disk: string | null
      try {
        disk = await fileSystemApi.readFileContent(path)
      } catch {
        disk = null
      }
      // 読む間に始まった保存も終わるまで待ち、保存で savedContent が変わったら読み直す
      await waitForPendingSave(path)
      if (disposedRef.current) return
      const key = toComparablePath(path)
      const decision = decideExternalChange({
        before,
        after: getOpenFileSnapshot(path),
        disk,
        dismissed: dismissedRef.current.get(key)
      })
      if (decision.kind === 'retry') continue
      if (decision.kind === 'gone') return
      if (decision.kind === 'in-sync') {
        dismissedRef.current.delete(key)
        marks.clear(path)
        return
      }
      let fallback: ExternalChangeFallback
      if (decision.kind === 'replace-clean') {
        if (replaceCleanTabWithDisk(path, decision.expected, disk)) {
          marks.clear(path)
          return
        }
        fallback = decision.otherwise
      } else {
        fallback = decision
      }
      if (fallback.kind === 'suppressed') return
      notifiedRef.current.set(key, fallback.notified)
      marks.mark(path, fallback.mark)
      return
    }
  }
  const checkRef = useLatestRef(check)

  // 同じパスを確かめている最中に届いた通知は、終わった後の 1 回にまとめる。確かめられなかった(例外の)ときは記録して何もしない
  // (次の通知・フォーカスの復帰で確かめ直す)
  // 合流の状態(実行中のパス)は描画をまたいで保つ。作るのは最初の依頼のとき(描画の中で ref を読まない)
  const coalescerRef = useRef<KeyedCoalescer<string> | null>(null)
  const scheduleCheck = (path: string): void => {
    coalescerRef.current ??= createKeyedCoalescer<string>({
      toKey: toComparablePath,
      run: (target) => checkRef.current(target),
      onError: (err) => console.error('[useExternalFileChanges] check failed:', err),
      isDisposed: () => disposedRef.current
    })
    coalescerRef.current.schedule(path)
  }
  const scheduleCheckRef = useLatestRef(scheduleCheck)
  const { retain, setCheckHandler } = marks

  // 保存の直前の照合で上書きをキャンセルしたときの依頼(marks.requestCheck)も、印を直接付けず確認を通す。確認が
  // 知らせたディスクの内容を控えるので、「このまま編集する」で消した後に同じ内容で出し直さない
  useEffect(
    () => setCheckHandler((path) => scheduleCheckRef.current(path)),
    [setCheckHandler, scheduleCheckRef]
  )

  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      // 破棄したら監視を止める(fs:setWatchedFiles は最新の呼び出しだけを反映する)
      void fileSystemApi.setWatchedFiles([]).catch(() => undefined)
    }
  }, [])

  // 開いているタブの一覧・開いているフォルダが変わるたびに、main の監視の対象を置き換え、閉じたタブの印を捨てる
  useEffect(() => {
    const paths = pathsKey === '' ? [] : pathsKey.split(PATH_SEPARATOR)
    void fileSystemApi.setWatchedFiles(paths).catch(() => undefined)
    retain(paths)
    const keep = new Set(paths.map(toComparablePath))
    for (const known of [notifiedRef.current, dismissedRef.current]) {
      for (const key of [...known.keys()]) if (!keep.has(key)) known.delete(key)
    }
    // folderPath は effect の中で読まないが、変わったら送り直すために依存に入れる
  }, [pathsKey, retain, folderPath])

  useEffect(
    () =>
      fileSystemApi.onExternalFileChange(({ paths }) => {
        for (const path of paths) scheduleCheckRef.current(path)
      }),
    [scheduleCheckRef]
  )

  // フォーカスの復帰・ウィンドウの再表示で全タブを確かめる(監視が拾わない変更の補助)
  useEffect(() => {
    const checkAll = (): void => {
      for (const path of openPathsRef.current) scheduleCheckRef.current(path)
    }
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') checkAll()
    }
    window.addEventListener('focus', checkAll)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', checkAll)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [scheduleCheckRef, openPathsRef])

  // 再読込の確認を連打しても 1 回だけ読む(パスごと。別のタブの再読込の最中でも押せる)
  const reloadingRef = useRef(new Set<string>())

  if (!isFileTabActive || activeFilePath === null) return null
  const kind = marks.get(activeFilePath)
  if (kind === null) return null
  const path = activeFilePath
  return {
    path,
    kind,
    reload:
      kind === 'modified'
        ? () => {
            const key = toComparablePath(path)
            if (reloadingRef.current.has(key) || !onConfirm(EXTERNAL_RELOAD_CONFIRM_MESSAGE)) return
            reloadingRef.current.add(key)
            void reloadOpenFile(path).finally(() => {
              reloadingRef.current.delete(key)
              marks.clear(path)
            })
          }
        : null,
    dismiss: () => {
      const key = toComparablePath(path)
      const notified = notifiedRef.current.get(key)
      if (notified !== undefined) dismissedRef.current.set(key, notified)
      marks.clear(path)
    }
  }
}
