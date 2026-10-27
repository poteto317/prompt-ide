import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLoginShellPath } from '../agentShellEnv'
import { removeTempPathSync } from './helpers/tempDirGuard'

// 実物の /bin/sh で、印の間の取り出しと終了の検知を確かめる(macOS・Linux の開発者のローカルで走らせる。パターン 41)
// rc を読む対話シェル(zsh があれば zsh、無ければ bash)
const shell = (): string => (existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash')

// pid のプロセスが生きているか(シグナル 0 は存在の確認だけ。EPERM は他人のプロセスとして存在する)
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

describe('readLoginShellPath(実物のシェル)', () => {
  // 実機の ~/.profile などに依存しないよう、空の HOME に隔離する
  let home = ''
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'agent-shell-env-'))
  })
  afterAll(() => {
    // 準備が失敗して空のままなら消さない
    if (home !== '') removeTempPathSync(home)
  })

  it.skipIf(process.platform === 'win32')(
    '/bin/sh -l -i -c で PATH を取り出す',
    async () => {
      const path = await readLoginShellPath({
        env: { SHELL: '/bin/sh', HOME: home, PATH: '/usr/bin:/bin:/custom/bin' }
      })
      expect(path).not.toBeNull()
      expect(path?.split(':')).toContain('/usr/bin')
    },
    10_000
  )

  // rc がバックグラウンドプロセスを残しても、終了を待たずに PATH が取れ、残ったプロセスも止まる
  it.skipIf(process.platform === 'win32')(
    'rc が常駐プロセスを残しても 5 秒待たずに PATH を取り出し、残りを止める',
    async () => {
      // 残りの確認は、この rc が起動したプロセスの pid だけで行う(マシン全体を名前で探すと、並行して走る別の
      // テストの同じコマンドに当たる)
      const pidFile = join(home, 'rc-background.pid')
      const rc = `sleep 31 &\necho $! > '${pidFile}'\n`
      writeFileSync(join(home, '.zshrc'), rc)
      writeFileSync(join(home, '.bashrc'), rc)
      const startedAt = Date.now()
      const path = await readLoginShellPath({
        env: { SHELL: shell(), HOME: home, ZDOTDIR: home, PATH: '/usr/bin:/bin' }
      })
      expect(path).not.toBeNull()
      expect(Date.now() - startedAt).toBeLessThan(4000)
      await new Promise((r) => setTimeout(r, 300))
      const pid = Number(readFileSync(pidFile, 'utf8').trim())
      expect(Number.isInteger(pid) && pid > 0).toBe(true)
      expect(isAlive(pid)).toBe(false)
    },
    10_000
  )
})
