import { basename, dirname } from 'node:path'

// 開いているタブの親ディレクトリの非再帰の監視(設計書「未編集のタブの自動の再読込」)。ファイルそのものを監視すると、
// rename での置き換えの後にイベントが届かなくなるため(確認の結果 11)。イベントの種類は当てにせず、名前が開いているタブと
// 一致する(または名前が無い)ときに、間引いて通知する。判定(内容の比較)は renderer が行う

export const EXTERNAL_CHANGE_DEBOUNCE_MS = 300

export interface DirectoryWatch {
  close(): void
  on(event: 'error', listener: (err: Error) => void): unknown
}

export type WatchDirectory = (
  dir: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => DirectoryWatch

export interface OpenFileWatcherDeps {
  watch: WatchDirectory
  /** 変わった可能性のあるタブのパス(renderer から受け取った表記のまま)を所有者へ送る */
  notify: (ownerId: number, paths: string[]) => void
  debounceMs?: number
}

interface OwnerState {
  // 親ディレクトリ → (ファイル名 → renderer のパス)
  files: Map<string, Map<string, string>>
  watches: Map<string, DirectoryWatch>
  pending: Set<string>
  timer: ReturnType<typeof setTimeout> | null
}

export class OpenFileWatcher {
  private readonly owners = new Map<number, OwnerState>()
  // 所有者ごとの最新の更新の番号(beginUpdate)。番号は所有者をまたいで単調増加させ、clear で消した後に
  // 同じ番号が再び使われないようにする
  private readonly latestUpdates = new Map<number, number>()
  private nextUpdate = 0
  private readonly watch: WatchDirectory
  private readonly notify: OpenFileWatcherDeps['notify']
  private readonly debounceMs: number

  constructor({ watch, notify, debounceMs = EXTERNAL_CHANGE_DEBOUNCE_MS }: OpenFileWatcherDeps) {
    this.watch = watch
    this.notify = notify
    this.debounceMs = debounceMs
  }

  /** 一覧の検証(非同期)を始める前に呼ぶ。以前の更新を古いものにする */
  beginUpdate(ownerId: number): number {
    this.nextUpdate += 1
    this.latestUpdates.set(ownerId, this.nextUpdate)
    return this.nextUpdate
  }

  /** beginUpdate の番号がまだ最新か(後の beginUpdate・clear があれば false) */
  isCurrentUpdate(ownerId: number, update: number): boolean {
    return this.latestUpdates.get(ownerId) === update
  }

  /** 所有者の監視するファイルを置き換える(許可の確認は呼び出し側で済ませる) */
  setWatchedFiles(ownerId: number, paths: readonly string[]): void {
    const state = this.owners.get(ownerId) ?? {
      files: new Map(),
      watches: new Map(),
      pending: new Set<string>(),
      timer: null
    }
    this.owners.set(ownerId, state)
    const files = new Map<string, Map<string, string>>()
    for (const path of paths) {
      const dir = dirname(path)
      const byName = files.get(dir) ?? new Map<string, string>()
      byName.set(basename(path), path)
      files.set(dir, byName)
    }
    state.files = files
    for (const [dir, watch] of state.watches) {
      if (!files.has(dir)) {
        watch.close()
        state.watches.delete(dir)
      }
    }
    for (const dir of files.keys()) {
      if (state.watches.has(dir)) continue
      try {
        const watch = this.watch(dir, (_eventType, filename) =>
          this.onEvent(ownerId, dir, filename)
        )
        // エラーが出た監視は閉じ、ウィンドウのフォーカスの復帰での再確認に任せる
        watch.on('error', () => {
          watch.close()
          if (state.watches.get(dir) === watch) state.watches.delete(dir)
        })
        state.watches.set(dir, watch)
      } catch {
        // ディレクトリが無い・監視できないものは飛ばす(フォーカスの復帰での再確認に任せる)
      }
    }
    if (paths.length === 0) this.clear(ownerId)
  }

  private onEvent(ownerId: number, dir: string, filename: string | Buffer | null): void {
    const state = this.owners.get(ownerId)
    const byName = state?.files.get(dir)
    if (state === undefined || byName === undefined) return
    const name = filename === null ? null : filename.toString()
    if (name === null) {
      for (const path of byName.values()) state.pending.add(path)
    } else {
      const path = byName.get(name)
      if (path === undefined) return
      state.pending.add(path)
    }
    if (state.timer !== null) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = null
      const paths = [...state.pending]
      state.pending.clear()
      if (paths.length === 0) return
      // 送信先の破棄などで投げても、タイマーのコールバックから main の未捕捉例外にしない
      try {
        this.notify(ownerId, paths)
      } catch {
        // 通知できなかった変更は、フォーカスの復帰での再確認に任せる
      }
    }, this.debounceMs)
  }

  /** 所有者の監視をすべて閉じる(フォルダの切り替え・ウィンドウの破棄・リロード) */
  clear(ownerId: number): void {
    // 検証中の一覧(beginUpdate)も古いものにする。監視をまだ張っていない(リロード直前の最初の呼び出し)ときも消す
    this.latestUpdates.delete(ownerId)
    const state = this.owners.get(ownerId)
    if (state === undefined) return
    for (const watch of state.watches.values()) watch.close()
    if (state.timer !== null) clearTimeout(state.timer)
    this.owners.delete(ownerId)
  }

  /** 監視しているディレクトリの数(テスト用) */
  watchedDirectoryCount(ownerId: number): number {
    return this.owners.get(ownerId)?.watches.size ?? 0
  }
}
