import { describe, it, expect } from 'vitest'
import { spawn } from 'node-pty'

// 実物の node-pty が vitest(main のテストも jsdom の環境で走る)から読み込めて、pty で起動・出力・終了を受け取れること。
// postinstall(electron-builder install-app-deps)で build/Release の pty.node と spawn-helper(実行権限付き)が作られている前提。
// 失敗したら `ls -l node_modules/node-pty/build/Release` と `npm install`(引数なし)を確かめる(Task 1)
describe.skipIf(process.platform === 'win32')('node-pty(実物)', () => {
  it('pty で /bin/echo を起動し、出力と終了コード 0 を受け取る', async () => {
    const pty = spawn('/bin/echo', ['hello-pty'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/',
      env: { PATH: '/usr/bin:/bin' }
    })
    let output = ''
    pty.onData((data) => {
      output += data
    })
    const exitCode = await new Promise<number>((resolve) =>
      pty.onExit(({ exitCode }) => resolve(exitCode))
    )
    expect(output).toContain('hello-pty')
    expect(exitCode).toBe(0)
  })
})
