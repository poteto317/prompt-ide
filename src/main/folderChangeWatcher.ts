import type { FolderChangeEvent } from '@shared/types'
import { classifyFolderChange } from './folderChangeClassifier'
import { FolderChangeCoalescer } from './folderChangeCoalescer'

// 開いているフォルダの recursive の監視(設計書 2026-11-08「監視」)。所有者(webContents の id)ごとに、許可フォルダのルートを 1 本だけ
// 監視する。張るかは renderer の依頼(enable・disable)、どのフォルダかは main の許可フォルダ(getFolder)で決める(L-571)。
// 通知は classifyFolderChange で分け、FolderChangeCoalescer で待ちと上限の早い方で 1 回にまとめて送る(L-399)。
// 監視が張れない・error を受けたときは黙って監視無しにし、ウィンドウのフォーカスの復帰での取り直しに任せる。
// 開いているタブの監視(openFileWatcher.ts)とは別の監視(対象・名前の絞り方・rename への備えが違う)

export const FOLDER_CHANGE_WAIT_MS = 300
export const FOLDER_CHANGE_MAX_WAIT_MS = 1_000

export interface FolderWatch {
  close(): void
  on(event: 'error', listener: (err: Error) => void): unknown
}

/** フォルダを recursive で監視する(この環境での張り方は recursiveFolderWatch.ts の createRecursiveFolderWatch) */
export type WatchFolder = (
  folder: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => FolderWatch

export interface FolderChangeWatcherDeps {
  /** null は「この環境では監視しない」(Linux) */
  watch: WatchFolder | null
  /** 所有者の今の許可フォルダ(FolderAccessManager.get) */
  getFolder: (ownerId: number) => string | undefined
  notify: (ownerId: number, event: FolderChangeEvent) => void
  platform: NodeJS.Platform
  waitMs?: number
  maxWaitMs?: number
}

/** 張っている監視と、そのフォルダ(片方だけがある状態を作らないよう、組で持つ) */
interface ActiveWatch {
  folder: string
  watch: FolderWatch
}

interface OwnerState {
  /** 張っている監視(null は監視無し) */
  current: ActiveWatch | null
  /** この所有者の通知の合流(張り直し・閉じるで未送信を捨てる) */
  coalescer: FolderChangeCoalescer
}

export class FolderChangeWatcher {
  // 有効な所有者だけが入る(disable で消す)
  private readonly owners = new Map<number, OwnerState>()
  private readonly watchFolder: WatchFolder | null
  private readonly getFolder: FolderChangeWatcherDeps['getFolder']
  private readonly notify: FolderChangeWatcherDeps['notify']
  private readonly platform: NodeJS.Platform
  private readonly waitMs: number
  private readonly maxWaitMs: number

  constructor({
    watch,
    getFolder,
    notify,
    platform,
    waitMs = FOLDER_CHANGE_WAIT_MS,
    maxWaitMs = FOLDER_CHANGE_MAX_WAIT_MS
  }: FolderChangeWatcherDeps) {
    this.watchFolder = watch
    this.getFolder = getFolder
    this.notify = notify
    this.platform = platform
    this.waitMs = waitMs
    this.maxWaitMs = maxWaitMs
  }

  /** renderer の依頼。有効にして、今の許可フォルダを張る(張っていれば何もしない)。同期で行う(StrictMode の二重実行を到着の順に処理する。L-469) */
  enable(ownerId: number): void {
    let state = this.owners.get(ownerId)
    if (state === undefined) {
      state = this.createOwnerState(ownerId)
      this.owners.set(ownerId, state)
    }
    const folder = this.getFolder(ownerId) ?? null
    if (state.current !== null && state.current.folder === folder) return
    this.open(state, folder)
  }

  /** renderer の依頼・リロード・クラッシュ・破棄。監視を閉じ、予約を取り消し、無効に戻す */
  disable(ownerId: number): void {
    const state = this.owners.get(ownerId)
    if (state === undefined) return
    this.closeCurrent(state)
    this.owners.delete(ownerId)
  }

  /** 許可フォルダが変わった。有効な所有者だけ、前の監視を閉じて新しいフォルダを張る */
  onFolderChanged(ownerId: number): void {
    const state = this.owners.get(ownerId)
    if (state === undefined) return
    this.open(state, this.getFolder(ownerId) ?? null)
  }

  /** 監視しているフォルダ(テスト用) */
  watchedFolder(ownerId: number): string | null {
    const state = this.owners.get(ownerId)
    return state?.current?.folder ?? null
  }

  // 前の監視を閉じ、合流の予約と未送信を捨ててから張る。張れなければ監視無しのまま(フォーカスの復帰に任せる)
  private open(state: OwnerState, folder: string | null): void {
    this.closeCurrent(state)
    if (folder === null || this.watchFolder === null) return
    let created: FolderWatch | null = null
    try {
      created = this.watchFolder(folder, (_eventType, filename) => {
        // 閉じた監視の遅れた通知を、新しいフォルダの通知にしない(L-037)
        if (created === null || state.current?.watch !== created) return
        const relativePath = filename === null ? null : filename.toString()
        state.coalescer.add(classifyFolderChange(relativePath, this.platform))
      })
    } catch {
      // ENOENT・EMFILE など。監視無しのまま
      return
    }
    const watch = created
    watch.on('error', () => {
      if (state.current?.watch !== watch) return
      // その場では張り直さない。次の folder-changed か enable で張り直す
      this.closeCurrent(state)
    })
    state.current = { folder, watch }
  }

  private createOwnerState(ownerId: number): OwnerState {
    return {
      current: null,
      coalescer: new FolderChangeCoalescer({
        waitMs: this.waitMs,
        maxWaitMs: this.maxWaitMs,
        send: (event) => this.notify(ownerId, event)
      })
    }
  }

  private closeCurrent(state: OwnerState): void {
    const current = state.current
    state.current = null
    state.coalescer.cancel()
    if (current === null) return
    try {
      current.watch.close()
    } catch {
      // 閉じられない監視は捨てる
    }
  }
}
