import type { GitFileStatus, GitStatusResult } from '@shared/types'

export function statusChar(code: string): string {
  if (code === '?') return 'U'
  return code.trim() || '·'
}

// 未解決のマージコンフリクトを表す porcelain の index/workingDir の組(実機で
// 'UU' 'AA' 'DD' 'AU' 'UD' 'UA' 'DU' を確認済み)。この状態は index/workingDir が
// どちらも ' ' 以外・'?' 以外になるため、isStagedFile が除外しないと
// 「ステージ済み・コミット可能」として StagedSection やコミットボタンに
// 表示されてしまう。実際には git add で明示的に「解決済み」とするまで
// 通常の意味でのステージ済みではなく、git commit 自体は拒否するが、
// アプリの表示だけが未解決のコンフリクトを見落とす原因になる。
// ChangesSection の取り消しボタンの表示判定でも使う(main 側の ls-files -u による拒否と表示を揃える)
export function isConflictedFile(f: GitFileStatus): boolean {
  if (f.index === 'U' || f.workingDir === 'U') return true
  if (f.index === 'A' && f.workingDir === 'A') return true
  if (f.index === 'D' && f.workingDir === 'D') return true
  return false
}

// GitRepoView.tsx(コミットボタンの有効/無効判定)と StagedSection.tsx
// (一覧フィルタ)の両方が同じ「ステージ済みかどうか」の判定を必要とするため
// 共有する。片方だけ判定基準を変えると、コミットボタンの状態と
// StagedSection の表示内容が食い違ってしまう
export function isStagedFile(f: GitFileStatus): boolean {
  return f.index !== ' ' && !isUntrackedFile(f) && !isConflictedFile(f)
}

// 「未追跡かどうか」は ChangesSection.tsx の一覧フィルタ・ステータス文字の
// 出し分けと、useDiffOperations.ts の「main 側で疑似diffを組み立てるか」の判定に
// 必要で、それぞれが index === '?' を直接書いていた。この判定は「未追跡ファイルの
// diff が空表示になる」不具合の原因そのもののため、isStagedFile と同じ理由で
// 共有する(片方だけ判定基準を変えると、一覧の表示と diff の取得方法が食い違う)
export function isUntrackedFile(f: GitFileStatus): boolean {
  return f.index === '?'
}

// 「未ステージの変更を持つか」は ChangesSection.tsx の一覧フィルタと
// useAppState.ts の diffTab 自動クローズ判定の両方が必要とし、それぞれが
// この条件を独立に書いていた(コメントでのみ「揃える」ことが保証されていた)。
// isStagedFile/isUntrackedFile と同じ理由で、片方だけ判定基準を変えると
// 一覧の表示と自動クローズの判定が食い違うため共有する
export function isUnstagedFile(f: GitFileStatus): boolean {
  return f.workingDir !== ' ' || isUntrackedFile(f)
}

// 「リポジトリが無ければ Git 操作は実行不可」という判定は useGitRemoteOperations.ts
// (push/pull/fetch)と useGitBranchOperations.ts(ブランチ切替)がそれぞれ独立に
// 同じ式を書いていた。isStagedFile 等と同じ理由(片方だけ判定基準を変えると
// 操作間で disabled 判定が食い違う)で共有ヘルパーに統一する
export function isGitOperationDisabled(gitStatus: GitStatusResult | null): boolean {
  return gitStatus === null || !gitStatus.isRepo
}
