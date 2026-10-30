export type GitFileStatus = {
  path: string
  index: string
  workingDir: string
  /** リネーム(index === 'R')のときの旧パス。ステージ済みリネームの diff は
   *  新パスだけを pathspec に渡すと git がリネーム検出をせず「新規ファイル」
   *  として出力してしまうため、その判定に使う */
  from?: string
}

export type GitStatusResult = {
  isRepo: boolean
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  /** マージ中（`.git/MERGE_HEAD` がある）か。リポジトリでないときは false */
  mergeInProgress: boolean
  /** リモート origin があるか(`git remote` の出力に origin の行がある)。リポジトリでないときは false */
  hasOrigin: boolean
  /** リモートが 1 つでもあるか(`git remote` の出力が空でない)。origin 以外の名前のリモートだけ(git clone -o github
   *  など)でも真。バナー『リモートが未設定です』はこれが偽のときだけ出す。リポジトリでないときは false */
  hasRemote: boolean
  /** 現在のブランチの upstream の短い名前(simple-git の status.tracking。例: origin/main)。リモートの ref が
   *  消えた gone でも値が入る。未設定・detached HEAD・リポジトリでないときは null */
  upstream: string | null
  /** ブランチ上にいない(detached HEAD・リベース中・bisect 中)か。リポジトリでないときは false */
  detached: boolean
}

/** プルの結果。コンフリクトは失敗ではなく結果で返す(同期が失敗と区別して案内を出し、プッシュへ進まないため) */
export type GitPullResult = {
  /** プルの後に未解決のファイルがあるか(マージ・rebase のどちらのコンフリクトも含む) */
  conflicted: boolean
  /** git がコンフリクトを失敗として返したときの文言。git.pull() が例外を投げるかは stderr の有無で変わる
   *  (取得済みのマージと autostash の復元は投げない)。公開の pull はこの文言を従来どおり表示する */
  errorMessage?: string
}

/** コンフリクトのブロックごとの解決方法（both は自分 → 相手の順） */
export const CONFLICT_CHOICES = ['ours', 'theirs', 'both'] as const
export type ConflictChoice = (typeof CONFLICT_CHOICES)[number]

export type ConflictSegment =
  | { kind: 'text'; lines: string[] }
  | {
      kind: 'conflict'
      ours: string[]
      theirs: string[]
      base?: string[]
      /** base がある（diff3 形式）ときの `|||||||` 行のラベル。書き戻しで復元する */
      baseLabel?: string
      oursLabel: string
      theirsLabel: string
    }

/** コンフリクト中のファイルに、ステージ 2(自分)・3(相手)があるか。両方あれば内容の競合、
 *  片方だけなら追加/削除型(ファイル単位で「残す」か「削除する」を選ぶ) */
export type ConflictStages = { ours: boolean; theirs: boolean }

/** ブロックを解析できない理由。binary=NUL を含む、markers=マーカーを解析できない/UTF-8 として不正、
 *  not-regular=通常のファイルでない(リンク・ディレクトリ)、missing=作業ツリーにファイルが無い、
 *  submodule=サブモジュール(gitlink, mode 160000)のコンフリクト。アプリでは解決せず、ターミナルへ案内する */
export type ConflictUnparsableReason =
  | 'binary'
  | 'markers'
  | 'not-regular'
  | 'missing'
  | 'submodule'

export type ConflictFile =
  | {
      status: 'parsed'
      stages: ConflictStages
      segments: ConflictSegment[]
      /** コンフリクトのブロックの順の SHA-1 ダイジェスト */
      digests: string[]
      eol: '\n' | '\r\n'
    }
  | { status: 'unparsable'; reason: ConflictUnparsableReason; stages: ConflictStages }

export type GitLogRefKind = 'current' | 'branch' | 'remote' | 'tag'

export interface GitLogRef {
  kind: GitLogRefKind
  /** refs/heads/ などを除いた短い名前(origin/main) */
  name: string
}

export type GitLogEntry = {
  hash: string
  /** 親のハッシュ。ルートコミットは空 */
  parents: string[]
  /** このコミットを指す ref */
  refs: GitLogRef[]
  /** HEAD が指すコミットか(detached を含む) */
  isHead: boolean
  message: string
  date: string
  authorName: string
}

export type GitBranch = {
  name: string
  current: boolean
  // ブランチ上にいないときに getBranches が返す疑似項目の印(実在のブランチではない)。それ以外の項目には付かない
  isDetachedHead?: boolean
}

// 安全削除(git branch -d)の結果。未マージで削除しなかった場合を例外ではなく
// 戻り値で返す(renderer 側が git のエラーメッセージ文字列で分岐しないため)
export type DeleteBranchResult = { deleted: true } | { deleted: false; reason: 'not-fully-merged' }

// 退避(git stash)の 1 件。番号(stash@{n})は他の操作で別の退避を指すようになるため、
// 識別には退避コミットの SHA を使う
export type GitStashEntry = {
  sha: string
  /** 表示用のメッセージ。メッセージ無しの退避では最後のコミットの件名。空のこともある */
  message: string
  /** 退避したブランチ名。detached HEAD では '(no branch)'。件名から取れなければ空文字 */
  branch: string
  /** 退避した日時(ISO 8601) */
  createdAt: string
}

// 一括の取り消しで、確認ダイアログを出した時点で見せた対象 1 件。main は実行時の status から作った
// 一覧とこの一覧を(パスでソートして)完全一致で照合し、違えば何も変えずに中止する。
// path は simple-git の status の表記(ネストした git リポジトリは末尾 '/'、末尾空白は trim 済み)、
// status は index + workingDir の 2 文字(例: ' M' / '??')。対象の決定には使わない
export interface DiscardAllEntry {
  path: string
  status: string
}

// 一括の取り消しの結果。成功は done。途中で失敗したとき、1 件以上取り消し済み(作業ツリーが変わった)なら
// 例外ではなく partial で返す: renderer は例外のとき開いているタブ・ツリーを再読込しないため、取り消し済みの
// ファイルを古いタブが上書きして変更を戻してしまう(パターン52)。1 件目で失敗した場合と、一覧の不一致・
// 分類での拒否(何も変えていない)は従来どおり例外。cause は IPC を渡れないので含めない
export type DiscardAllResult = { status: 'done' } | { status: 'partial'; message: string }

// ブランチのマージの結果。コンフリクトで途中の状態(MERGE_HEAD と、マーカー入りの作業ツリー)を残して止まった
// ときは、作業ツリーが変わっているため例外ではなく conflict で返す: renderer は例外のとき開いているタブを
// 再読込しないため、返さないと古い内容のタブが保存でマーカーと相手側の変更を消してしまう(パターン52)。
// 事前検証の失敗・MERGE_HEAD の無い失敗・未解決ファイルが無いまま中止した失敗(作業ツリーは元のまま)は例外。
// message は `コンフリクトしました（<ファイル一覧>）。解決するか、マージを中止してください`
export type MergeBranchResult = { status: 'merged' } | { status: 'conflict'; message: string }

// タグの種類。IPC 境界(gitPayloadParser の assertCreateTagArg)が値の検証に使うため、配列としても公開する
export const TAG_KINDS = ['lightweight', 'annotated'] as const
export type TagKind = (typeof TAG_KINDS)[number]

// タグの作成の要求。付ける先は常に現在の HEAD。message は注釈付きのときだけ使う(軽量では無視する)
export type CreateTagRequest = { name: string; kind: TagKind; message: string }

// 退避の復元(git stash pop 相当)の結果。事前検証の失敗と、巻き戻しに成功した apply 失敗は例外で返す
// (作業ツリーは変わっていない)。作業ツリーが変わったうえで警告が要る場合だけ、例外ではなく結果で返す:
// renderer は例外のとき開いているタブを再読込しないため、結果で返さないと変更後のディスクを
// 古いタブが上書きする。cause は IPC を渡れないので含めない
export type StashPopResult =
  | { status: 'restored' }
  | {
      /** 復元は済んだが、一覧から削除できなかった */
      status: 'dropFailed'
      message: string
    }
  | {
      /** 復元に失敗し、巻き戻しにも失敗した(途中の変更が残っているおそれ) */
      status: 'rollbackFailed'
      message: string
    }

// リポジトリの clone(git:cloneRepository)の結果。canceled は保存先の選択(OS のダイアログ)の取り消しと、
// clone 中の中止(git:cancelCloneRepository・ウィンドウを閉じた)の両方。失敗は例外(日本語の文言)
export type CloneRepositoryResult = { status: 'cloned'; path: string } | { status: 'canceled' }
