import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 利用者の settings.json には触れない。app.getPath('userData') はテストごとの一時ディレクトリを返す
const userDataDir = vi.hoisted(() => ({ current: '' }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => userDataDir.current) }
}))

// 実物の fs を使い、writeFile と rename だけを差し替えられるようにする(書き込みの途中・rename の失敗を作るため)
const fsHooks = vi.hoisted(() => ({
  beforeRename: null as null | (() => Promise<void>),
  partialWriteGate: null as null | Promise<void>,
  renameError: null as null | Error
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const writeFile: typeof actual.writeFile = async (file, data, options) => {
    // 書き込みの途中を再現する: 先頭だけ書いた状態で止め、合図のあとに残りを書く
    if (fsHooks.partialWriteGate !== null && typeof data === 'string') {
      await actual.writeFile(file, data.slice(0, 5), options)
      await fsHooks.partialWriteGate
    }
    return actual.writeFile(file, data, options)
  }
  const rename: typeof actual.rename = async (from, to) => {
    if (fsHooks.beforeRename !== null) await fsHooks.beforeRename()
    if (fsHooks.renameError !== null) throw fsHooks.renameError
    return actual.rename(from, to)
  }
  const mocked = { ...actual, writeFile, rename }
  return { ...mocked, default: mocked }
})

import { readSettingsFile, writeSettingsFile } from '../settingsFileStore'

const settingsPath = (): string => join(userDataDir.current, 'settings.json')

beforeEach(() => {
  userDataDir.current = mkdtempSync(join(tmpdir(), 'prompt-ide-settings-'))
  fsHooks.beforeRename = null
  fsHooks.partialWriteGate = null
  fsHooks.renameError = null
})

afterEach(() => {
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
    fsHooks.renameError = Object.assign(new Error('EPERM: rename failed'), { code: 'EPERM' })

    await expect(writeSettingsFile({ modelId: 'claude-opus-4-8' })).rejects.toThrow('EPERM')

    expect(readdirSync(userDataDir.current)).toEqual(['settings.json'])
    expect(readFileSync(settingsPath(), 'utf-8')).toBe(original)
  })

  it('並行して書いても一時ファイルが衝突せず、すべての変更が残る', async () => {
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
