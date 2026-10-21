import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  symlinkSync,
  lstatSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 利用者の settings.json には触れない。app.getPath('userData') はテストごとの一時ディレクトリを返す
const userDataDir = vi.hoisted(() => ({ current: '' }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => userDataDir.current) }
}))

// 実物の fs を使い、writeFile・open・rename・rm・lstat・realpath だけを差し替えられるようにする
// (書き込み先の解決の失敗・書き込みの途中・書き込みの失敗・sync の順序・sync と close の失敗・rename の失敗・後始末の失敗を作るため)
const fsHooks = vi.hoisted(() => ({
  beforeRename: null as null | (() => Promise<void>),
  beforeWrite: null as null | ((file: string) => void),
  partialWriteGate: null as null | Promise<void>,
  writeError: null as null | Error,
  syncError: null as null | Error,
  closeError: null as null | Error,
  renameError: null as null | Error,
  rmError: null as null | Error,
  realpathError: null as null | Error,
  lstatError: null as null | Error,
  realpathCalls: 0,
  events: [] as string[]
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const writeFile: typeof actual.writeFile = async (file, data, options) => {
    if (fsHooks.beforeWrite !== null && typeof file === 'string') fsHooks.beforeWrite(file)
    // 書き込みの途中の失敗を再現する: 先頭だけ書いてから投げる(ディスクの空き不足など)
    if (fsHooks.writeError !== null && typeof data === 'string') {
      await actual.writeFile(file, data.slice(0, 5), options)
      throw fsHooks.writeError
    }
    // 書き込みの途中を再現する: 先頭だけ書いた状態で止め、合図のあとに残りを書く
    // (残りは同じファイルへの上書き。wx のまま書くと、自分が作った一時ファイルで EEXIST になるため)
    if (fsHooks.partialWriteGate !== null && typeof data === 'string') {
      await actual.writeFile(file, data.slice(0, 5), options)
      await fsHooks.partialWriteGate
      const rest = typeof options === 'object' && options !== null ? options : {}
      return actual.writeFile(file, data, { ...rest, flag: 'w' })
    }
    return actual.writeFile(file, data, options)
  }
  const open: typeof actual.open = async (file, flags, mode) => {
    const handle = await actual.open(file, flags, mode)
    const sync = handle.sync.bind(handle)
    const close = handle.close.bind(handle)
    handle.sync = async () => {
      fsHooks.events.push('sync')
      if (fsHooks.syncError !== null) throw fsHooks.syncError
      return sync()
    }
    // close の失敗を再現するときも、実物の fd は閉じる(テストで fd を漏らさないため)
    handle.close = async () => {
      fsHooks.events.push('close')
      await close()
      if (fsHooks.closeError !== null) throw fsHooks.closeError
    }
    return handle
  }
  const rename: typeof actual.rename = async (from, to) => {
    fsHooks.events.push('rename')
    if (fsHooks.beforeRename !== null) await fsHooks.beforeRename()
    if (fsHooks.renameError !== null) throw fsHooks.renameError
    return actual.rename(from, to)
  }
  const rm: typeof actual.rm = async (file, options) => {
    if (fsHooks.rmError !== null) throw fsHooks.rmError
    return actual.rm(file, options)
  }
  const realpath = (async (file: Parameters<typeof actual.realpath>[0]) => {
    fsHooks.realpathCalls += 1
    if (fsHooks.realpathError !== null) throw fsHooks.realpathError
    return actual.realpath(file)
  }) as typeof actual.realpath
  const lstat = (async (file: Parameters<typeof actual.lstat>[0]) => {
    if (fsHooks.lstatError !== null) throw fsHooks.lstatError
    return actual.lstat(file)
  }) as typeof actual.lstat
  const mocked = { ...actual, writeFile, open, rename, rm, lstat, realpath }
  return { ...mocked, default: mocked }
})

import { readSettingsFile, writeSettingsFile, SettingsFileError } from '../settingsFileStore'

const settingsPath = (): string => join(userDataDir.current, 'settings.json')

// 書き込みの失敗は元の例外を console.error に記録し、固定の文言の SettingsFileError で返す(L-017)
let consoleErrorSpy: MockInstance<typeof console.error> | null = null

async function expectWriteFailure(write: Promise<void>, cause?: unknown): Promise<void> {
  const err = await write.then(
    () => {
      throw new Error('writeSettingsFile は失敗するはず')
    },
    (e: unknown) => e
  )
  expect(err).toBeInstanceOf(SettingsFileError)
  expect(String(err)).not.toContain(userDataDir.current)
  if (cause !== undefined) {
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[settingsFileStore] failed to write settings file:',
      cause
    )
  } else {
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[settingsFileStore] failed to write settings file:',
      expect.anything()
    )
  }
}

function loggedWriteCause(): Error & { code?: string } {
  const call = consoleErrorSpy?.mock.calls.find(
    (c) => c[0] === '[settingsFileStore] failed to write settings file:'
  )
  if (!call) throw new Error('書き込みの失敗が記録されていない')
  return call[1] as Error & { code?: string }
}

beforeEach(() => {
  userDataDir.current = mkdtempSync(join(tmpdir(), 'prompt-ide-settings-'))
  fsHooks.beforeRename = null
  fsHooks.beforeWrite = null
  fsHooks.partialWriteGate = null
  fsHooks.writeError = null
  fsHooks.syncError = null
  fsHooks.closeError = null
  fsHooks.renameError = null
  fsHooks.rmError = null
  fsHooks.realpathError = null
  fsHooks.lstatError = null
  fsHooks.realpathCalls = 0
  fsHooks.events = []
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
  rmSync(userDataDir.current, { recursive: true, force: true })
})

describe('writeSettingsFile の原子的な書き込み', () => {
  it('書き込みの途中に読み込んでも、書きかけの JSON を見ずに前の内容を読める', async () => {
    writeFileSync(settingsPath(), JSON.stringify({ agentCliKind: 'copilot' }))
    let release: () => void = () => {}
    fsHooks.partialWriteGate = new Promise<void>((resolve) => {
      release = resolve
    })

    const writing = writeSettingsFile({ modelId: 'claude-opus-4-8' })
    let readDuringWrite: Promise<unknown>
    try {
      // 書き込みが先頭だけ書いた状態で止まるまで待つ
      await vi.waitFor(() => {
        const names = readdirSync(userDataDir.current)
        const partial = names.some(
          (name) => readFileSync(join(userDataDir.current, name), 'utf-8').length === 5
        )
        expect(partial).toBe(true)
      })
      readDuringWrite = readSettingsFile()
      await readDuringWrite.catch(() => {})
    } finally {
      // 失敗しても書き込みを止めたままにしない(後続のテストが書き込みのキューで待たされるため)
      release()
      await writing
    }

    await expect(readDuringWrite).resolves.toEqual({ agentCliKind: 'copilot' })
    await expect(readSettingsFile()).resolves.toEqual({
      agentCliKind: 'copilot',
      modelId: 'claude-opus-4-8'
    })
  })

  it('一時ファイルを書き終えて rename する直前に読み込んでも、前の内容を読める', async () => {
    writeFileSync(settingsPath(), JSON.stringify({ agentCliKind: 'copilot' }))
    let readDuringWrite: unknown
    fsHooks.beforeRename = async () => {
      readDuringWrite = await readSettingsFile()
    }

    await writeSettingsFile({ modelId: 'claude-opus-4-8' })

    expect(readDuringWrite).toEqual({ agentCliKind: 'copilot' })
  })

  it('rename が失敗したら、一時ファイルを残さず元のファイルを壊さずに失敗を返す', async () => {
    const original = JSON.stringify({ agentCliKind: 'copilot', encryptedApiKey: 'enc' })
    writeFileSync(settingsPath(), original)
    const renameErr = Object.assign(new Error('EPERM: rename failed'), { code: 'EPERM' })
    fsHooks.renameError = renameErr

    await expectWriteFailure(writeSettingsFile({ modelId: 'claude-opus-4-8' }), renameErr)

    expect(readdirSync(userDataDir.current)).toEqual(['settings.json'])
    expect(readFileSync(settingsPath(), 'utf-8')).toBe(original)
  })

  it('一時ファイルの書き込みが途中で失敗したら、一時ファイルを残さず元のファイルを壊さずに失敗を返す', async () => {
    const original = JSON.stringify({ agentCliKind: 'copilot', encryptedApiKey: 'enc' })
    writeFileSync(settingsPath(), original)
    const writeErr = Object.assign(new Error('ENOSPC: no space left on device'), {
      code: 'ENOSPC'
    })
    fsHooks.writeError = writeErr

    await expectWriteFailure(writeSettingsFile({ modelId: 'claude-opus-4-8' }), writeErr)

    expect(readdirSync(userDataDir.current)).toEqual(['settings.json'])
    expect(readFileSync(settingsPath(), 'utf-8')).toBe(original)
  })

  it('一時ファイルと同じ名前のファイルが既にあれば、切り詰めず消さずに失敗を返す(wx)', async () => {
    const original = JSON.stringify({ agentCliKind: 'copilot' })
    writeFileSync(settingsPath(), original)
    let collidedName = ''
    fsHooks.beforeWrite = (file) => {
      collidedName = file
      writeFileSync(file, 'someone else')
    }

    await expectWriteFailure(writeSettingsFile({ modelId: 'claude-opus-4-8' }))
    // 一時ファイルを消すかどうかは、SettingsFileError で包む前の元の例外(EEXIST)で判定する
    expect(loggedWriteCause().code).toBe('EEXIST')

    expect(readFileSync(collidedName, 'utf-8')).toBe('someone else')
    expect(readFileSync(settingsPath(), 'utf-8')).toBe(original)
  })

  it.skipIf(process.platform === 'win32')(
    'settings.json がシンボリックリンクで、リンク先の解決(realpath)が ENOENT 以外で失敗したら、一時ファイルを作らずリンクとリンク先を壊さずに失敗を返す',
    async () => {
      const linkTargetDir = mkdtempSync(join(tmpdir(), 'prompt-ide-settings-target-'))
      try {
        const original = JSON.stringify({ agentCliKind: 'copilot' })
        const linkTarget = join(linkTargetDir, 'real-settings.json')
        writeFileSync(linkTarget, original)
        symlinkSync(linkTarget, settingsPath())
        const realpathErr = Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES'
        })
        fsHooks.realpathError = realpathErr

        await expectWriteFailure(writeSettingsFile({ modelId: 'claude-opus-4-8' }), realpathErr)

        expect(fsHooks.events).toEqual([])
        expect(lstatSync(settingsPath()).isSymbolicLink()).toBe(true)
        expect(readdirSync(userDataDir.current)).toEqual(['settings.json'])
        expect(readdirSync(linkTargetDir)).toEqual(['real-settings.json'])
        expect(readFileSync(linkTarget, 'utf-8')).toBe(original)
      } finally {
        rmSync(linkTargetDir, { recursive: true, force: true })
      }
    }
  )

  it('settings.json が通常のファイルなら realpath を呼ばないので、realpath が失敗する環境でも保存できる', async () => {
    writeFileSync(settingsPath(), JSON.stringify({ agentCliKind: 'copilot' }))
    fsHooks.realpathError = Object.assign(new Error('EISDIR: illegal operation'), {
      code: 'EISDIR'
    })

    await writeSettingsFile({ modelId: 'claude-opus-4-8' })

    expect(fsHooks.realpathCalls).toBe(0)
    expect(readdirSync(userDataDir.current)).toEqual(['settings.json'])
    await expect(readSettingsFile()).resolves.toEqual({
      agentCliKind: 'copilot',
      modelId: 'claude-opus-4-8'
    })
  })

  it('書き込み先の確認(lstat)が ENOENT 以外で失敗したら、一時ファイルを作らず元のファイルを壊さずに失敗を返す', async () => {
    const original = JSON.stringify({ agentCliKind: 'copilot' })
    writeFileSync(settingsPath(), original)
    const lstatErr = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    fsHooks.lstatError = lstatErr

    await expectWriteFailure(writeSettingsFile({ modelId: 'claude-opus-4-8' }), lstatErr)

    expect(fsHooks.realpathCalls).toBe(0)
    expect(fsHooks.events).toEqual([])
    expect(readdirSync(userDataDir.current)).toEqual(['settings.json'])
    expect(readFileSync(settingsPath(), 'utf-8')).toBe(original)
  })

  it('一時ファイルを sync してから rename する', async () => {
    await writeSettingsFile({ modelId: 'claude-opus-4-8' })

    expect(fsHooks.events).toEqual(['sync', 'close', 'rename'])
    await expect(readSettingsFile()).resolves.toEqual({ modelId: 'claude-opus-4-8' })
  })

  it('sync も close も失敗したら、close の失敗を console.error に記録し、sync の例外を記録して SettingsFileError を返す', async () => {
    const original = JSON.stringify({ agentCliKind: 'copilot' })
    writeFileSync(settingsPath(), original)
    const syncErr = Object.assign(new Error('EIO: sync failed'), { code: 'EIO' })
    const closeErr = Object.assign(new Error('EBADF: close failed'), { code: 'EBADF' })
    fsHooks.syncError = syncErr
    fsHooks.closeError = closeErr

    await expectWriteFailure(writeSettingsFile({ modelId: 'claude-opus-4-8' }), syncErr)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[settingsFileStore] failed to close temp file:',
      closeErr
    )
    expect(fsHooks.events).toEqual(['sync', 'close'])
    expect(readdirSync(userDataDir.current)).toEqual(['settings.json'])
    expect(readFileSync(settingsPath(), 'utf-8')).toBe(original)
  })

  it('close だけが失敗したら、rename せずに close の例外を記録して SettingsFileError を返す', async () => {
    const original = JSON.stringify({ agentCliKind: 'copilot' })
    writeFileSync(settingsPath(), original)
    const closeErr = Object.assign(new Error('EIO: close failed'), { code: 'EIO' })
    fsHooks.closeError = closeErr

    await expectWriteFailure(writeSettingsFile({ modelId: 'claude-opus-4-8' }), closeErr)

    expect(fsHooks.events).toEqual(['sync', 'close'])
    expect(readdirSync(userDataDir.current)).toEqual(['settings.json'])
    expect(readFileSync(settingsPath(), 'utf-8')).toBe(original)
  })

  it('一時ファイルの後始末が失敗したら console.error に記録し、元の例外を記録して SettingsFileError を返す', async () => {
    const renameErr = Object.assign(new Error('EPERM: rename failed'), { code: 'EPERM' })
    const rmErr = Object.assign(new Error('EBUSY: rm failed'), { code: 'EBUSY' })
    fsHooks.renameError = renameErr
    fsHooks.rmError = rmErr

    await expectWriteFailure(writeSettingsFile({ modelId: 'claude-opus-4-8' }), renameErr)

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[settingsFileStore] failed to remove temp file:',
      rmErr
    )
  })

  it('書き込みが失敗しても、次の書き込みは止まらずに保存できる', async () => {
    fsHooks.renameError = Object.assign(new Error('EPERM: rename failed'), { code: 'EPERM' })
    await expectWriteFailure(writeSettingsFile({ modelId: 'claude-opus-4-8' }))

    fsHooks.renameError = null
    await writeSettingsFile({ agentCliKind: 'copilot' })

    await expect(readSettingsFile()).resolves.toEqual({ agentCliKind: 'copilot' })
  })

  it('並行して書いても、すべての変更が残り、一時ファイルも残らない', async () => {
    await Promise.all([
      writeSettingsFile({ encryptedApiKey: 'enc' }),
      writeSettingsFile({ modelId: 'claude-opus-4-8' }),
      writeSettingsFile({ agentCliKind: 'copilot' })
    ])

    expect(readdirSync(userDataDir.current)).toEqual(['settings.json'])
    await expect(readSettingsFile()).resolves.toEqual({
      encryptedApiKey: 'enc',
      modelId: 'claude-opus-4-8',
      agentCliKind: 'copilot'
    })
  })

  it.skipIf(process.platform === 'win32')(
    '既存のファイルが 0o644 でも、書き込み後は 0o600 になる',
    async () => {
      writeFileSync(settingsPath(), JSON.stringify({}), { mode: 0o644 })

      await writeSettingsFile({ encryptedApiKey: 'enc' })

      expect(statSync(settingsPath()).mode & 0o777).toBe(0o600)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'settings.json がシンボリックリンクなら、リンクのまま残し、リンク先を新しい内容にして、リンク先のディレクトリに一時ファイルを残さない',
    async () => {
      const linkTargetDir = mkdtempSync(join(tmpdir(), 'prompt-ide-settings-target-'))
      try {
        const linkTarget = join(linkTargetDir, 'real-settings.json')
        writeFileSync(linkTarget, JSON.stringify({ agentCliKind: 'copilot' }))
        symlinkSync(linkTarget, settingsPath())

        await writeSettingsFile({ modelId: 'claude-opus-4-8' })

        expect(lstatSync(settingsPath()).isSymbolicLink()).toBe(true)
        expect(JSON.parse(readFileSync(linkTarget, 'utf-8'))).toEqual({
          agentCliKind: 'copilot',
          modelId: 'claude-opus-4-8'
        })
        expect(readdirSync(linkTargetDir)).toEqual(['real-settings.json'])
        expect(readdirSync(userDataDir.current)).toEqual(['settings.json'])
      } finally {
        rmSync(linkTargetDir, { recursive: true, force: true })
      }
    }
  )

  it.skipIf(process.platform === 'win32')(
    'settings.json がリンク切れのシンボリックリンクなら、リンクを通常のファイルに置き換えて保存する',
    async () => {
      const linkTargetDir = mkdtempSync(join(tmpdir(), 'prompt-ide-settings-target-'))
      try {
        const missingTarget = join(linkTargetDir, 'missing.json')
        symlinkSync(missingTarget, settingsPath())

        await writeSettingsFile({ modelId: 'claude-opus-4-8' })

        expect(lstatSync(settingsPath()).isSymbolicLink()).toBe(false)
        await expect(readSettingsFile()).resolves.toEqual({ modelId: 'claude-opus-4-8' })
        expect(readdirSync(linkTargetDir)).toEqual([])
        expect(readdirSync(userDataDir.current)).toEqual(['settings.json'])
      } finally {
        rmSync(linkTargetDir, { recursive: true, force: true })
      }
    }
  )

  it.skipIf(process.platform === 'win32')('新しく作るファイルも 0o600 になる', async () => {
    await writeSettingsFile({ encryptedApiKey: 'enc' })

    expect(statSync(settingsPath()).mode & 0o777).toBe(0o600)
  })

  it.skipIf(process.platform === 'win32')(
    'rename の前の一時ファイルも 0o600 で、暗号文が他の利用者から読めない',
    async () => {
      const tempModes: number[] = []
      fsHooks.beforeRename = async () => {
        for (const name of readdirSync(userDataDir.current)) {
          if (name === 'settings.json') continue
          tempModes.push(statSync(join(userDataDir.current, name)).mode & 0o777)
        }
      }

      await writeSettingsFile({ encryptedApiKey: 'enc' })

      expect(tempModes).toEqual([0o600])
    }
  )
})
