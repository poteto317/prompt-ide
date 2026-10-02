import type { GitStatusResult } from '@shared/types'
import { GIT_REMOTE_TIMEOUT_SECONDS } from '@shared/remoteTimeout'

// リモートの状態バナーの種類。リモートが 1 つも無い / origin はあるが現在のブランチに upstream が無い
export type RemoteSetupKind = 'no-origin' | 'no-upstream'

// 初期化・origin の追加・初回 push の成功の後に、フォーカスを移す先(次の操作のボタン)。
// 移す先の要素は data-remote-setup-focus 属性にこの値を持つ(useRemoteSetupFocus が描画の後に探す)。
// 属性に書く側(RemoteSetupBanner・SourceControlToolbar)は `satisfies RemoteSetupFocusTarget` で型と結ぶ
// (綴りの食い違いを typecheck で検出する。パターン 88)
export type RemoteSetupFocusTarget = 'add-remote' | 'set-upstream' | 'push'

// 設計書の「状態ごとの表示」の表。バナー(RemoteSetupBanner)とテストが同じ判定を使う。
// - no-origin はリモートが 1 つも無い(hasRemote が偽)ときだけ出す。origin の追加はブランチに関係しないため、
//   detached でも出す
// - origin 以外の名前のリモートだけがある(git clone -o github など。hasOrigin が偽・hasRemote が真)ときは何も出さない。
//   既存の push / pull はそのリモートと通信でき、『リモートが未設定です』は事実と違う。upstream の無いブランチでも、
//   初回 push は origin 固定で「リモート origin が未設定のため…」と拒否されるため no-upstream も出さない
// - 初回 push はブランチの上でしかできないため、detached(detached HEAD・リベース中・bisect 中)では出さない
// - upstream が設定済み(gone・ローカルのブランチを upstream にしているものを含む)なら出さない
// - コミットの有無は区別しない(init の直後も no-upstream。押すと main がコミット無しで拒否する)。
//   GitStatusResult はコミットの有無を持たないため、コミットが無くても branch.<b>.remote / merge が設定済みなら
//   upstream に origin/<b> が入り(git status の「No commits yet on main...origin/main [gone]」)、バナーは出さない。
//   この状態で初回 push を押すと、main は設計書の順(4. コミットの有無 → 5. upstream の有無)に確かめるため、未コミットの間は
//   「コミットが無いため…」、コミットの後は「upstream は既に設定されています」で拒否される。どちらでも出さない方が正しい
// - マージ中かどうかは見ない(マージのバナーと両方出す。初回 push・追加は作業ツリー・index を変えない)
export function getRemoteSetupState(gitStatus: GitStatusResult | null): RemoteSetupKind | null {
  if (gitStatus === null || !gitStatus.isRepo) return null
  if (!gitStatus.hasRemote) return 'no-origin'
  if (!gitStatus.hasOrigin) return null
  if (gitStatus.detached || gitStatus.branch === null) return null
  return gitStatus.upstream === null ? 'no-upstream' : null
}

export function buildRemoteSetupBannerText(kind: RemoteSetupKind, branch: string | null): string {
  return kind === 'no-origin' ? 'リモートが未設定です' : `upstream が未設定です（${branch ?? ''}）`
}

// 初回 push 中の案内。秒数は main の打ち切り(GIT_REMOTE_TIMEOUT_MS)と同じ定数から組み立てる(パターン 87・88)
export const SETTING_UPSTREAM_NOTICE = `初回 push 中です。応答が ${GIT_REMOTE_TIMEOUT_SECONDS} 秒途絶えると打ち切ります`
