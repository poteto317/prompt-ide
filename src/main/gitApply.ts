import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

// stderr の蓄積上限。エラーメッセージとして意味を持つのは冒頭の数行(rejected hunk
// の位置等)程度で十分なため、壊れた/巨大なパッチで git apply が大量の
// エラー行を吐いた場合でも、Electron メインプロセスのメモリを圧迫しないよう
// 一定サイズで打ち切る
const MAX_STDERR_BYTES = 64 * 1024

// stdout の蓄積上限。--numstat -z の出力(パッチが触るパスの一覧)を受け取るために蓄積する
const MAX_STDOUT_BYTES = 64 * 1024

// git apply がハングした場合のタイムアウト。ファイルシステムのロック競合・
// Windows のウイルス対策ソフトによる横取り・壊れた index 等で子プロセスが
// 'close'/'error' のどちらも発火しないまま止まると、タイムアウトが無ければ
// runGitApply の Promise が永久に解決せず、呼び出し元(useDiffOperations.ts)の
// isHunkOperationInProgressRef・共有ファイルロックが finally で解除されないまま、
// そのファイルのハンクステージ/アンステージボタンがアプリ再起動まで無効化され続ける
const GIT_APPLY_TIMEOUT_MS = 30_000

// SIGTERM(kill() の既定シグナル)を無視するプロセスがバックグラウンドに残り
// 続けないよう、猶予時間内に終了しなければ SIGKILL へエスカレーションする。
// cliService.ts の killWithEscalation と同じパターン(値も同じ 5 秒)
const SIGKILL_GRACE_MS = 5_000

/**
 * git apply を cwd の継承以外の環境で動かすときの環境(エージェントの変更の隠れた git の記録。agentBaselineGit の
 * baselineGitSpawnEnvironment が作る)。env は子プロセスの環境そのもの、config は `git -c` で args の前に付ける設定
 */
export interface GitApplyEnvironment {
  env: Record<string, string>
  config: readonly string[]
}

// git apply の実行(child_process.spawn 経由)のみを担う。simple-git 経由の高レベル
// API 呼び出しとはプロセス起動という異なる責務のため gitService.ts から分離している。
// environment を渡すと、その環境と -c で動かす。打ち切り(30 秒で SIGTERM、5 秒の猶予の後に SIGKILL)は渡さないときと同じ
export function runGitApply(
  cwd: string,
  filePath: string,
  args: string[],
  input: string,
  environment?: GitApplyEnvironment
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    // proc/stdin の 'error' と 'close' は組み合わせによっては両方発火しうる
    // (例: spawn 失敗後の EPIPE で stdin が 'error' を出した後に 'close' も来る)。
    // reject/resolve は一度だけ行う
    let settled = false
    const settleReject = (err: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      reject(err)
    }
    const proc =
      environment === undefined
        ? spawn('git', args, { cwd })
        : spawn('git', [...environment.config.flatMap((entry) => ['-c', entry]), ...args], {
            cwd,
            env: environment.env,
            // agentBaselineGit の記録の git と同じ。Windows で console のウィンドウを開かない
            windowsHide: true
          })
    // close イベントの発火有無で「実際にプロセスが終了したか」を追跡する
    // (cliService.ts の killWithEscalation と同じ理由。settled は Promise が
    // 確定したかを表すだけで、SIGKILL エスカレーションの判定には使えない)
    let exited = false
    const timeoutId = setTimeout(() => {
      if (settled) return
      proc.kill()
      const escalationTimer = setTimeout(() => {
        if (!exited) proc.kill('SIGKILL')
      }, SIGKILL_GRACE_MS)
      escalationTimer.unref()
      settleReject(new Error(`git apply timed out for ${filePath}`))
    }, GIT_APPLY_TIMEOUT_MS)
    // stdout を誰も読まないと、Node の Readable はポーズ状態のままバッファし
    // 続け、OS のパイプバッファ(通常 64KB 程度)が満杯になった時点で子プロセス
    // 側の書き込みがブロックされる。git apply は通常成功時に何も出力しないが、
    // reject 情報等で予期せず出力される可能性はゼロではないため、上限を超えた分は
    // 読み捨てつつ、'data' を読み続けて防ぐ。--numstat のように stdout が結果になる
    // 呼び出しのため、上限までは蓄積して resolve で返す
    let stdout = ''
    let stdoutBytes = 0
    const stdoutDecoder = new StringDecoder('utf-8')
    proc.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= MAX_STDOUT_BYTES) return
      stdoutBytes += chunk.length
      stdout += stdoutDecoder.write(chunk)
    })
    let stderr = ''
    // 上限判定は stderr.length(UTF-16 コード単位数)ではなく chunk.length
    // (Buffer の実バイト数)の累計で行う。マルチバイト文字(日本語等)は
    // toString() で 1 バイトあたり 1 文字未満に圧縮されるため、文字数で
    // 判定すると MAX_STDERR_BYTES の意図した上限を実質的に超過してしまう
    let stderrBytes = 0
    // chunk.toString() を 'data' イベントごとに個別で呼んで文字列連結すると、
    // UTF-8 のマルチバイトシーケンス(日本語等)が OS パイプの都合でチャンク境界に
    // ちょうど分割された場合、分割された断片がそれぞれ不完全なシーケンスとして
    // 独立にデコードされ、U+FFFD(文字化け)になる(実機で再現確認済み)。
    // StringDecoder はチャンクをまたぐ不完全なマルチバイトシーケンスを内部で
    // 保持し、次の write で正しく結合してくれる
    const stderrDecoder = new StringDecoder('utf-8')
    proc.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return
      stderrBytes += chunk.length
      stderr += stderrDecoder.write(chunk)
    })
    proc.on('error', settleReject)
    // spawn 自体が失敗した場合(git が PATH に無い等)、その後の stdin への書き込みが
    // EPIPE を stdin 自身の 'error' イベントとして出すことがある。ハンドラが無いと
    // unhandled error として Electron のメインプロセスがクラッシュする
    proc.stdin.on('error', settleReject)
    proc.on('close', (code: number) => {
      exited = true
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      if (code === 0) {
        resolvePromise(stdout)
      } else {
        reject(new Error(`git apply failed for ${filePath}: ${stderr.trim()}`))
      }
    })
    proc.stdin.write(input)
    proc.stdin.end()
  })
}

// --no-ignore-whitespace は、ユーザーの gitconfig の apply.ignoreWhitespace を
// 打ち消すために明示する。これが change に設定されていると --ignore-space-change
// 相当となり、空白だけが異なる別の位置にハンクがマッチして、ユーザーが選んで
// いない箇所が index / 作業ツリーに入り得る。getDiff 側でも同じ方針で diff.noprefix /
// diff.external / textconv / color.ui を打ち消している。
// stageHunk / unstageHunk / discardHunkPatch は --cached と --reverse の組み合わせだけが
// 異なるため、共有フラグを一箇所にまとめる(将来もう1つフラグが必要になったとき、
// 直し忘れで片方だけ古いフラグのまま残ることを防ぐ)
const HUNK_APPLY_COMMON_ARGS = ['--whitespace=nowarn', '--no-ignore-whitespace', '-']

async function runHunkApply(
  folderPath: string,
  filePath: string,
  patch: string,
  options: { reverse: boolean }
): Promise<void> {
  const args = ['apply', '--cached']
  if (options.reverse) args.push('--reverse')
  args.push(...HUNK_APPLY_COMMON_ARGS)
  await runGitApply(folderPath, filePath, args, patch)
}

export function stageHunk(folderPath: string, filePath: string, patch: string): Promise<void> {
  return runHunkApply(folderPath, filePath, patch, { reverse: false })
}

export function unstageHunk(folderPath: string, filePath: string, patch: string): Promise<void> {
  return runHunkApply(folderPath, filePath, patch, { reverse: true })
}

// ハンクの取り消しの git の引数(作業ツリーだけへの逆適用。--cached・--index を付けないので index は読まず、変えない)
export const DISCARD_HUNK_APPLY_ARGS: readonly string[] = [
  'apply',
  '--reverse',
  ...HUNK_APPLY_COMMON_ARGS
]

// ハンクの取り消し。作業ツリーだけへ逆適用する(--cached を付けないので index は変わらない)。
// エージェントの変更の隠れた git の記録は、environment に隠れた git の環境を渡して同じ打ち切りで動かす
// (agentChangesRevert の applyHunkRevert)
export async function discardHunkPatch(
  folderPath: string,
  filePath: string,
  patch: string,
  environment?: GitApplyEnvironment
): Promise<void> {
  await runGitApply(folderPath, filePath, [...DISCARD_HUNK_APPLY_ARGS], patch, environment)
}

// パッチが触るパスの一覧。--numstat -z は出力が NUL 区切りで、通常は `<追加>\t<削除>\t<パス>\0`
// (バイナリは `-\t-\t<パス>\0`)になる。ファイルは書き換えない。
// git 2.50.1 の実機では、git apply --numstat -z はリネームでも新しいパスだけを返す
// (`git diff --numstat -z` は `<追加>\t<削除>\t\0<旧>\0<新>\0`)。どちらの形式でも空要素を除いて
// 解釈できるようにしている
// reverse: 逆適用したときの対象を調べる(--reverse では old / new が入れ替わり、順方向とは
// 別のファイルを指しうる)
export async function listPatchPaths(
  folderPath: string,
  patch: string,
  options: { reverse: boolean } = { reverse: false }
): Promise<string[]> {
  const args = ['apply', '--numstat', '-z', ...(options.reverse ? ['--reverse'] : []), '-']
  const output = await runGitApply(folderPath, '(patch)', args, patch)
  return output
    .split('\0')
    .filter((token) => token !== '')
    .map((token) => token.replace(/^\d+\t\d+\t|^-\t-\t/, ''))
    .filter((path) => path !== '')
}
