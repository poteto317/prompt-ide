import type { ExternalChangeKind } from '@shared/types'

// 外部変更の 1 パスの判定(設計書「未編集のタブの自動の再読込と、編集中のタブへの通知」の 1〜6)。読む前と後のタブの
// 控え・読んだディスクの内容・「このまま編集する」で消した覚えから、何をするかを決める。副作用(置き換え・印)は
// 呼び出し側(useExternalFileChanges)が行う

/** 知らせた(または「このまま編集する」で消した)ときのディスクの内容と、そのときの savedContent */
export interface NotifiedDisk {
  disk: string | null
  savedContent: string
}

/** 置き換えをしない(またはできなかった)ときの扱い */
export type ExternalChangeFallback =
  | { kind: 'suppressed' }
  | { kind: 'mark'; mark: ExternalChangeKind; notified: NotifiedDisk }

export type ExternalChangeDecision =
  /** 読む間にタブが閉じられた */
  | { kind: 'gone' }
  /** 読む間に保存が挟まった(savedContent が変わった)。読み直す */
  | { kind: 'retry' }
  /** ディスクが savedContent と同じ(自分の保存・元に戻った)。印と消した覚えを捨てる */
  | { kind: 'in-sync' }
  /** 未編集のタブをディスクの内容で置き換える。置き換えられなければ otherwise に従う */
  | {
      kind: 'replace-clean'
      expected: { content: string; savedContent: string }
      otherwise: ExternalChangeFallback
    }
  | ExternalChangeFallback

export interface ExternalChangeInput {
  /** 読む前に取ったタブの控え */
  before: { content: string; savedContent: string }
  /** 読んだ後(保存を待った後)のタブの控え。閉じられていれば null */
  after: { savedContent: string } | null
  /** ディスクの内容。読めない(消えた)ときは null */
  disk: string | null
  /** 「このまま編集する」で消した覚え */
  dismissed: NotifiedDisk | undefined
}

export function decideExternalChange({
  before,
  after,
  disk,
  dismissed
}: ExternalChangeInput): ExternalChangeDecision {
  if (after === null) return { kind: 'gone' }
  if (after.savedContent !== before.savedContent) return { kind: 'retry' }
  if (disk !== null && disk === before.savedContent) return { kind: 'in-sync' }
  // 消した変更と同じなら知らせ直さない。違えば知らせる(古い覚えは次の dismiss で上書きされる)
  const fallback: ExternalChangeFallback =
    dismissed !== undefined &&
    dismissed.savedContent === before.savedContent &&
    dismissed.disk === disk
      ? { kind: 'suppressed' }
      : {
          kind: 'mark',
          mark: disk === null ? 'deleted' : 'modified',
          notified: { disk, savedContent: before.savedContent }
        }
  // 置き換えるのは未編集のときだけ(編集中のタブを自動で上書きしない)
  if (before.content === before.savedContent) {
    return {
      kind: 'replace-clean',
      expected: { content: before.content, savedContent: before.savedContent },
      otherwise: fallback
    }
  }
  return fallback
}
