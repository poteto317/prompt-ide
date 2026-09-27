import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const mockSpawn = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  default: { spawn: mockSpawn },
  spawn: mockSpawn
}))

import { stageHunk, unstageHunk } from '../gitApply'

beforeEach(() => {
  vi.clearAllMocks()
})

type MockStdin = EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }

function createMockProcess(): {
  proc: EventEmitter & { stdin: MockStdin; stdout: EventEmitter; stderr: EventEmitter }
  emitClose: (code: number) => void
  emitStderr: (data: string) => void
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: MockStdin
    stdout: EventEmitter
    stderr: EventEmitter
  }
  const stdin = new EventEmitter() as MockStdin
  stdin.write = vi.fn()
  stdin.end = vi.fn()
  proc.stdin = stdin
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  return {
    proc,
    emitClose: (code: number) => proc.emit('close', code),
    emitStderr: (data: string) => proc.stderr.emit('data', Buffer.from(data))
  }
}

describe('stageHunk', () => {
  it('git apply --cached を実行し、patch を stdin に書き込む', async () => {
    const { proc, emitClose } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    emitClose(0)
    await promise
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['apply', '--cached', '--whitespace=nowarn', '--no-ignore-whitespace', '-'],
      {
        cwd: '/project'
      }
    )
    expect(proc.stdin.write).toHaveBeenCalledWith('PATCH_TEXT')
    expect(proc.stdin.end).toHaveBeenCalled()
  })

  it('プロセスが非ゼロ終了コードの場合、stderr を含むエラーで reject する', async () => {
    const { proc, emitClose, emitStderr } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    emitStderr('patch does not apply')
    emitClose(1)
    await expect(promise).rejects.toThrow(/patch does not apply/)
  })

  it('stderr が大量に出力されても、蓄積するバッファに上限を設ける(メモリ枯渇防止)', async () => {
    // 壊れた/巨大なパッチで git apply が大量の reject-hunk エラー行を吐いた場合、
    // stderr += chunk.toString() を無制限に続けると Electron メインプロセスの
    // メモリを圧迫する。エラーメッセージとして意味を持つのは先頭の数行程度で
    // よいため、一定サイズで打ち切る
    const { proc, emitClose, emitStderr } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    // 小さなチャンクを大量に送り、合計で上限(64KB)を大きく超えさせる
    for (let i = 0; i < 2000; i++) {
      emitStderr('a'.repeat(200))
    }
    emitClose(1)
    let rejected: Error | undefined
    try {
      await promise
    } catch (err) {
      rejected = err as Error
    }
    expect(rejected).toBeDefined()
    // 合計送信量は 2000 * 200 = 400,000 バイトだが、蓄積は 64KB 程度で
    // 打ち切られているはず(1チャンク分の超過は許容する)
    expect(rejected!.message.length).toBeLessThan(70_000)
  })

  it('マルチバイト文字(日本語)の stderr でも、蓄積上限をバイト数(文字数ではなく)で判定する', async () => {
    // stderr += chunk.toString() で UTF-8 の Buffer を文字列化すると、日本語は
    // 1文字 3 バイトが 1 文字(UTF-16 コード単位1個)に圧縮される。蓄積上限を
    // stderr.length(文字数)で判定すると、実際のバイト数は文字数の最大 3 倍
    // 積まれるまで打ち切られず、MAX_STDERR_BYTES で意図したメモリ上限を
    // 実質的に超過してしまう。Buffer のバイト長(chunk.length)で判定する必要がある
    const { proc, emitClose, emitStderr } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    // 3 バイト/文字の日本語チャンクを大量に送る(合計 300,000 文字 = 900,000 バイト)
    for (let i = 0; i < 3000; i++) {
      emitStderr('あ'.repeat(100))
    }
    emitClose(1)
    let rejected: Error | undefined
    try {
      await promise
    } catch (err) {
      rejected = err as Error
    }
    expect(rejected).toBeDefined()
    // Buffer.byteLength で実際の UTF-8 バイト数を測り、上限(64KB)を大きく
    // 超えていないことを確認する(1チャンク分の超過は許容する)
    expect(Buffer.byteLength(rejected!.message, 'utf-8')).toBeLessThan(70_000)
  })

  it('git apply プロセスがハングして close/error を一切発火しない場合、タイムアウトで kill し reject する(ボタンが永久に disabled のまま固まるのを防ぐ)', async () => {
    // ファイルシステムのロック競合・Windows のウイルス対策ソフトによる横取り・
    // 壊れた index 等で git apply がハングし、'close'/'error' のどちらも
    // 発火しない場合、タイムアウトが無いと runGitApply の Promise が永久に
    // 解決せず、useDiffOperations 側の isHunkOperationInProgressRef・
    // 共有ファイルロックが finally で解除されないまま、そのファイルの
    // ハンクステージ/アンステージボタンがアプリ再起動まで無効化され続ける
    vi.useFakeTimers()
    try {
      const { proc } = createMockProcess()
      const kill = vi.fn()
      ;(proc as unknown as { kill: typeof kill }).kill = kill
      mockSpawn.mockReturnValue(proc)
      const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
      // rejects.toThrow によるハンドラ登録より先にタイマーが発火して reject すると
      // 一瞬 unhandled rejection になるため、アサーションを先に張ってから進める
      const assertion = expect(promise).rejects.toThrow(/timed out|タイムアウト/)
      // close/error を一切発火させないまま、タイムアウト時間を進める
      await vi.advanceTimersByTimeAsync(60_000)
      await assertion
      expect(kill).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('タイムアウト時に SIGTERM(既定シグナル)を無視するプロセスは、猶予時間後に SIGKILL へエスカレーションする(cliService.ts の killWithEscalation と同じパターン)', async () => {
    // proc.kill() の既定シグナル(SIGTERM)を無視して終了しないプロセスがいると、
    // 1回きりの kill() だけではゾンビプロセスとしてバックグラウンドに残り続ける。
    // cliService.ts の killWithEscalation は猶予時間内に 'close' が来なければ
    // SIGKILL で強制終了する。gitApply.ts のタイムアウトも同じ危険を持つため、
    // 同じエスカレーションパターンが必要
    vi.useFakeTimers()
    try {
      const { proc } = createMockProcess()
      const kill = vi.fn()
      ;(proc as unknown as { kill: typeof kill }).kill = kill
      mockSpawn.mockReturnValue(proc)
      const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
      const assertion = expect(promise).rejects.toThrow(/timed out|タイムアウト/)
      // タイムアウト発火(1回目の kill = SIGTERM 相当)
      await vi.advanceTimersByTimeAsync(30_000)
      await assertion
      expect(kill).toHaveBeenCalledTimes(1)
      expect(kill.mock.calls[0]).toEqual([])
      // プロセスが SIGTERM を無視して 'close' を発火しないまま猶予時間が経過すると、
      // SIGKILL で強制終了する
      await vi.advanceTimersByTimeAsync(10_000)
      expect(kill).toHaveBeenCalledTimes(2)
      expect(kill.mock.calls[1]).toEqual(['SIGKILL'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('タイムアウト後にプロセスが SIGTERM で正常終了すれば、SIGKILL へはエスカレーションしない', async () => {
    vi.useFakeTimers()
    try {
      const { proc, emitClose } = createMockProcess()
      const kill = vi.fn()
      ;(proc as unknown as { kill: typeof kill }).kill = kill
      mockSpawn.mockReturnValue(proc)
      const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
      const assertion = expect(promise).rejects.toThrow(/timed out|タイムアウト/)
      await vi.advanceTimersByTimeAsync(30_000)
      await assertion
      expect(kill).toHaveBeenCalledTimes(1)
      // SIGTERM を受けてプロセスが終了した
      emitClose(143)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(kill).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stderr のマルチバイト文字(日本語)が複数の data イベントの境界で分割されても、文字化けしない', async () => {
    // chunk.toString() を 'data' イベントごとに個別で呼んで文字列連結すると、
    // UTF-8 のマルチバイトシーケンスがチャンク境界でちょうど分割された場合、
    // 分割された断片はそれぞれ不完全なシーケンスとして独立にデコードされ、
    // 全体を1回でデコードした場合と異なり U+FFFD(文字化け)を生む
    // (実機で再現確認済み: '日'(e6 97 a5)の1バイト目だけを含むチャンクと
    // 残り2バイトのチャンクに分けると、素朴な toString() 連結は文字化けするが、
    // node:string_decoder の StringDecoder は正しく '日' を復元する)
    const { proc, emitClose } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    const fullMessage = Buffer.from('patch does not apply: 日本語のファイル名.txt', 'utf-8')
    // '日'(e6 97 a5)の1バイト目とそれ以降で意図的にチャンクを分割する
    const splitIndex = fullMessage.indexOf(Buffer.from('日本語', 'utf-8')) + 1
    proc.stderr.emit('data', fullMessage.subarray(0, splitIndex))
    proc.stderr.emit('data', fullMessage.subarray(splitIndex))
    emitClose(1)
    await expect(promise).rejects.toThrow('patch does not apply: 日本語のファイル名.txt')
  })

  it('stdin への書き込みで発生したエラー(spawn 失敗後の EPIPE 等)も reject し、unhandled error にしない', async () => {
    // git が PATH に無い等で spawn 自体が失敗した場合、その後の stdin.write/end が
    // EPIPE を stdin 自身の 'error' イベントとして出すことがある。ハンドラが無いと
    // Electron のメインプロセスがクラッシュする
    const { proc } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    proc.stdin.emit('error', new Error('EPIPE'))
    await expect(promise).rejects.toThrow('EPIPE')
  })

  it('stdout にリスナーを設定し読み捨てる(未読のままだと OS パイプバッファが満杯になり子プロセスがブロックし得るため)', async () => {
    const { proc, emitClose } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    // stdout に大量データが流れても listener が無ければ Node の Readable は
    // ポーズ状態のままバッファし続け、OS パイプが満杯になれば子プロセス側の
    // 書き込みがブロックされる。listener が付いていることを確認する
    expect(proc.stdout.listenerCount('data')).toBeGreaterThan(0)
    emitClose(0)
    await promise
  })
})

describe('unstageHunk', () => {
  it('git apply --cached --reverse を実行する', async () => {
    const { proc, emitClose } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = unstageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    emitClose(0)
    await promise
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['apply', '--cached', '--reverse', '--whitespace=nowarn', '--no-ignore-whitespace', '-'],
      { cwd: '/project' }
    )
  })
})
