import type { FolderChangeEvent } from '@shared/types'
import type { FolderChangeKind } from './folderChangeClassifier'

// 開いているフォルダの監視の通知の合流(所有者 1 つの分。設計書 2026-11-08「監視」)。分類済みの通知を、待ち(最後の通知から)と
// 上限(最初の未処理の通知から)の早い方で 1 回にまとめて送る(L-399)。監視を張る・閉じるのは FolderChangeWatcher が受け持ち、
// 所有者ごとに 1 つ作って張り直しをまたいで使う(張り直し・閉じるでは cancel で未送信を捨てる)
// renderer の受け側の合流(lib/refreshScheduler.ts の createRefreshScheduler)と、待ちと上限の 2 本のタイマーの張り方が同じ
// (片方のタイマーの扱いを直すときはもう片方も確かめる)。こちらは送るのが同期なので、実行中のもう 1 回・世代を持たない
// (閉じた監視の遅れた通知を捨てるのは FolderChangeWatcher の listener)

/**
 * 送る分類ごとに、ツリーも変わったか(ignore は送らない)。Record で分類を全部並べさせる(FolderChangeKind に値を足したとき、
 * ここで決め忘れると型エラーになる。決めずに git と同じ扱いへ黙って落とさない)
 */
const TREE_CHANGED_BY_KIND: Record<Exclude<FolderChangeKind, 'ignore'>, boolean> = {
  tree: true,
  git: false
}

export interface FolderChangeCoalescerOptions {
  waitMs: number
  maxWaitMs: number
  /** まとめた変化を送る。投げても、タイマーのコールバックから外へ出さない */
  send: (event: FolderChangeEvent) => void
}

export class FolderChangeCoalescer {
  /** 未送信の変化(null は未送信が無い。tree が混ざったかを treeChanged に持つ) */
  private pending: FolderChangeEvent | null = null
  private waitTimer: ReturnType<typeof setTimeout> | null = null
  private maxTimer: ReturnType<typeof setTimeout> | null = null

  private readonly options: FolderChangeCoalescerOptions

  constructor(options: FolderChangeCoalescerOptions) {
    this.options = options
  }

  /** 分類済みの通知を 1 つ足す。ignore は何もしない */
  add(kind: FolderChangeKind): void {
    if (kind === 'ignore') return
    this.pending = {
      treeChanged: (this.pending?.treeChanged ?? false) || TREE_CHANGED_BY_KIND[kind]
    }
    if (this.waitTimer !== null) clearTimeout(this.waitTimer)
    this.waitTimer = setTimeout(() => this.flush(), this.options.waitMs)
    if (this.maxTimer === null) {
      this.maxTimer = setTimeout(() => this.flush(), this.options.maxWaitMs)
    }
  }

  /** 予約と未送信を捨てる(監視を閉じる・張り直す) */
  cancel(): void {
    this.cancelTimers()
    this.pending = null
  }

  // 待ちと上限のどちらで呼ばれても両方を取り消し、未送信を 1 回にまとめて送る
  private flush(): void {
    this.cancelTimers()
    const event = this.pending
    if (event === null) return
    this.pending = null
    // 送信先の破棄などで投げても、タイマーのコールバックから main の未捕捉例外にしない
    try {
      this.options.send(event)
    } catch {
      // 送れなかった変化は、フォーカスの復帰での取り直しに任せる
    }
  }

  private cancelTimers(): void {
    if (this.waitTimer !== null) clearTimeout(this.waitTimer)
    if (this.maxTimer !== null) clearTimeout(this.maxTimer)
    this.waitTimer = null
    this.maxTimer = null
  }
}
