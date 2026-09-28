import { useRef, useState } from 'react'
import { toComparablePath } from '../lib/pathUtils'

export interface FileOperationLock {
  isLocked: (path: string) => boolean
  lock: (path: string) => void
  unlock: (path: string) => void
  /** いずれかのパスがロック中か。commit(git.index 全体を書き換える、特定の
   *  パスに紐付かない操作)が、実行中のハンク操作(git apply --cached)と
   *  競合していないかを判定するために使う */
  isAnyLocked: () => boolean
  /** 特定のパスに紐付かない全体ロック。commit 実行中は git.index 全体が
   *  書き換わるため、対象パスを問わずハンク操作を弾く必要がある。isLocked が
   *  内部でこの状態を吸収して返す(対象パスに関わらず true になる)ため、
   *  呼び出し元は isLocked だけを見ればよく、この状態を直接読む API は
   *  公開しない */
  lockGlobal: () => void
  unlockGlobal: () => void
}

// ChangesSection/StagedSection/GitRepoView/SourceControlPanel の isLocked
// デフォルト引数として共有する。呼び出し側ごとに `() => false` を書くと、
// レンダーのたびに新しい関数参照が生成され、将来これらのコンポーネントに
// React.memo を付けても props の参照比較が常に不一致になり効果が無くなる
export const alwaysUnlocked = (): boolean => false

// stage/unstage(useGitOperations)とハンク単位のステージ/アンステージ(useDiffOperations)は
// それぞれ独立に git.index を書き換える(git add/reset と git apply --cached)。
// 別々のロックしか持たないと、同じファイルに対して片方が実行中でももう片方の操作が
// 弾かれず、.git/index への同時書き込みが競合してしまう。両フックが同じロックを
// 共有することで、ファイル単位の排他制御を1箇所にまとめる。
export function useFileOperationLock(): FileOperationLock {
  const lockedPathsRef = useRef<Set<string>>(new Set())
  const globallyLockedRef = useRef(false)
  // isLocked の戻り値は毎回 lockedPathsRef.current から直接読むため再レンダー自体は
  // 不要だが、lock/unlock の呼び出し元(ボタンの disabled 表示)を再レンダーさせるために
  // ダミーの state を使う
  const [, forceRender] = useState(0)

  // lock/unlock の呼び出し元(useDiffOperations.ts の activeDiffTab.path と
  // useGitOperations.ts の gitStatusFiles 由来の path)は出所が異なり、
  // 表記が食い違うことがある(Windows の大文字小文字違い等)。生の文字列を
  // そのままキーにすると、同一ファイルが別ファイル扱いされて排他制御が
  // すり抜けてしまうため、Map のキーと同様に toComparablePath で正規化する
  // グローバルロック(commit 実行中)がかかっている間は、個別パスの実際のロック
  // 状態に関わらず全パスをロック中として扱う
  const isLocked = (path: string): boolean =>
    globallyLockedRef.current || lockedPathsRef.current.has(toComparablePath(path))

  const lock = (path: string): void => {
    lockedPathsRef.current.add(toComparablePath(path))
    forceRender((n) => n + 1)
  }

  const unlock = (path: string): void => {
    lockedPathsRef.current.delete(toComparablePath(path))
    forceRender((n) => n + 1)
  }

  // グローバルロック(commit 実行中)も「何かがロックされている」に含める。
  // 含めないと、push/pull(useGitRemoteOperations.ts)が commit 実行中かどうかを
  // path 非依存に判定する手段が無くなり、commit と pull が同時に .git/index を
  // 書き換えてしまう
  const isAnyLocked = (): boolean => lockedPathsRef.current.size > 0 || globallyLockedRef.current

  const lockGlobal = (): void => {
    globallyLockedRef.current = true
    forceRender((n) => n + 1)
  }

  const unlockGlobal = (): void => {
    globallyLockedRef.current = false
    forceRender((n) => n + 1)
  }

  return { isLocked, lock, unlock, isAnyLocked, lockGlobal, unlockGlobal }
}
