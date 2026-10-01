import type { SimpleGit } from 'simple-git'

// 退避(push)と復元(pop)が「作業ツリーに変更があるか」を判定するための status。
// push 側と pop 側で必ず同じ判定を使うよう、引数列をここ 1 箇所に集約する。
// サブモジュールの変更は数えない(--ignore-submodules=all): 数えると、サブモジュールの
// 中だけを変更した状態で「退避する変更がありません」(退避)と「作業中の変更があるため戻せません」
// (復元)の行き止まりになる。stash push は終了コード 0 で `No local changes to save`(退避なし)に
// なり、apply --index も失敗時の reset --hard もサブモジュールの中身には触れない
async function readStashRelevantStatus(git: SimpleGit): Promise<string> {
  return git.raw([
    'status',
    '--porcelain',
    '-z',
    '--untracked-files=all',
    '--ignore-submodules=all'
  ])
}

// マージ・cherry-pick・revert の途中か(MERGE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD のいずれかがある)。
// コンフリクトを解決してステージした後は ls-files -u に現れないため、ref の有無で判定する。
// rev-parse --verify -q は ref が無いと空文字で resolve する(hasMergeInProgress と同じ)
export async function hasInProgressOperation(git: SimpleGit): Promise<boolean> {
  for (const ref of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    const out = await git.raw(['rev-parse', '--verify', '-q', ref])
    if (out.trim() !== '') return true
  }
  return false
}

// 退避してよい状態かを検証する。前の検証に失敗したら後の git 呼び出しには進まない。
// 英語のエラーを見せる前に日本語で弾くものと、git が成功扱いにするものを事前に判定する:
// - 初期コミットが無いと git は終了コード 1 で `You do not have the initial commit yet`
// - コンフリクト中は終了コード 1 で `needs merge`
// - 解決済みのマージ・cherry-pick・revert の途中(コンフリクト無し)で退避すると、成功して
//   MERGE_HEAD 等が消え、「途中」の状態が黙って失われる(実機で確認)
// - サブモジュールの変更だけだと status は変更ありだが、stash push は終了コード 0 で
//   `No local changes to save`(退避なし)。stash に合わせ --ignore-submodules=all で判定する
// - 退避する変更が無くても git は終了コード 0 で `No local changes to save` と言う
//   (出力の文言に頼らず、事前の状態で判定する。パターン 28)
// rev-parse --verify -q は ref が無いと終了コード 1・stderr 空で終わり、simple-git は reject せず
// 空文字で resolve する(hasMergeInProgress と同じ)
export async function assertStashable(git: SimpleGit): Promise<void> {
  const head = await git.raw(['rev-parse', '--verify', '-q', 'HEAD'])
  if (head.trim() === '') throw new Error('コミットが無いため退避できません')
  const unmerged = await git.raw(['ls-files', '-u', '-z'])
  if (unmerged !== '') throw new Error('コンフリクト中のため退避できません')
  if (await hasInProgressOperation(git)) {
    throw new Error('マージ・cherry-pick・revert の途中のため退避できません')
  }
  const status = await readStashRelevantStatus(git)
  if (status === '') throw new Error('退避する変更がありません')
}

// 復元してよい状態(作業ツリーが完全にきれい)かを検証する。失敗時の巻き戻し(applyOrRollback)が
// 未コミットの変更・未追跡ファイルを消すため、失うものが無いことを事前に確かめる。
// 変更の判定は assertStashable と同じ status(readStashRelevantStatus)を使う
export async function assertRestorable(git: SimpleGit): Promise<void> {
  const status = await readStashRelevantStatus(git)
  if (status !== '') {
    throw new Error('作業中の変更があるため戻せません。先にコミットまたは退避してください')
  }
  // コンフリクトを解決して add した後のマージ・cherry-pick・revert の途中は、status も ls-files -u も
  // 空だが MERGE_HEAD 等は残る。復元に失敗すると巻き戻しの reset --hard がそれを消し、解決途中の
  // 状態が黙って失われる(成功しても途中の操作に退避の変更が混ざる)ため、退避(push)と同じく拒否する
  if (await hasInProgressOperation(git)) {
    throw new Error('マージ・cherry-pick・revert の途中のため戻せません')
  }
  // status に出ない変更は、ここまでの確認では見えない。assume-unchanged を付けたファイルの変更は
  // status に出ないのに、失敗時の reset --hard が HEAD の内容に戻して消す(実機で確認)ため、
  // 巻き戻しで失うものが無いという前提が崩れる。ls-files -v は `<タグ> <パス>` を NUL 区切りで返し、
  // assume-unchanged のタグは小文字になる(通常は H、skip-worktree は S)。skip-worktree の変更は
  // reset --hard で消えない(実機で確認)ので拒否しない
  const tagged = (await git.raw(['ls-files', '-v', '-z'])).split('\0')
  if (tagged.some((entry) => /^[a-z]/.test(entry))) {
    throw new Error(
      'assume-unchanged を付けたファイルがあるため戻せません（失敗したときの巻き戻しでそのファイルの変更が失われるおそれがあります）'
    )
  }
}
