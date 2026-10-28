import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  COPILOT_HOOK_PLUGIN_MANIFEST,
  COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME,
  COPILOT_HOOK_PLUGIN_SLOT_COUNT,
  createCopilotHookPluginSlots
} from '../agentCopilotHookPlugin'
import { buildCopilotHookConfig } from '../agentCopilotHookConfig'
import type { CopilotHookPluginSlots, CopilotHookPluginSlotsDeps } from '../agentCopilotHookPlugin'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'

// copilot に --plugin-dir で渡すプラグインのフォルダ(設計書 2026-10-26「プラグインのフォルダ」)。マニフェスト・枠の割り当て・
// 実 fs での権限・原子的な書き直し・作り直し・終了の後始末を確かめる(設定の JSON の形は agentCopilotHookConfig.test.ts)。
// userData の代わりに一時ディレクトリを使う

const TOKEN = 'ab'.repeat(32)
const OTHER_TOKEN = 'cd'.repeat(32)
const BASE = 'http://127.0.0.1:43210'
const POSIX = process.platform !== 'win32'

let dir: string
let rootDir: string
let warnSpy: MockInstance<typeof console.warn>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prompt-ide-copilot-plugin-test-'))
  rootDir = join(dir, COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME)
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warnSpy.mockRestore()
  removeTempPathSync(dir)
})

const slotsOf = (overrides: Partial<CopilotHookPluginSlotsDeps> = {}): CopilotHookPluginSlots =>
  createCopilotHookPluginSlots({ rootDir, ...overrides })
const modeOf = (target: string): number => statSync(target).mode & 0o777
const hooksFileOf = (slotDir: string): string => join(slotDir, 'hooks', 'hooks.json')

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('マニフェストと枠の定数', () => {
  it('マニフェストはアプリのものと分かる名前と説明', () => {
    expect(COPILOT_HOOK_PLUGIN_MANIFEST).toEqual({
      name: 'prompt-ide-agent-hooks',
      version: '1.0.0',
      description:
        'prompt-ide がエージェントの変更の区別に使う hooks（アプリが起動した copilot だけに渡します）'
    })
    expect(COPILOT_HOOK_PLUGIN_SLOT_COUNT).toBe(4)
    expect(COPILOT_HOOK_PLUGIN_ROOT_DIR_NAME).toBe('agent-hooks-copilot')
  })
})

describe('createCopilotHookPluginSlots(枠の割り当て)', () => {
  it('空いている一番小さい番号を返し、4 つで null、返した番号を再び使う。フォルダは <root>/slot-<番号>', () => {
    const slots = slotsOf()
    const taken = [slots.acquire(), slots.acquire(), slots.acquire(), slots.acquire()]
    expect(taken.map((slot) => slot?.number)).toEqual([1, 2, 3, 4])
    expect(taken[1]?.dir).toBe(join(rootDir, 'slot-2'))
    expect(slots.acquire()).toBeNull()
    if (taken[2] === null) throw new Error('slot-3 が無い')
    slots.release(taken[2])
    expect(slots.acquire()?.number).toBe(3)
  })

  it('removeTokenFilesSync の後は枠を貸さない', () => {
    const slots = slotsOf()
    slots.removeTokenFilesSync()
    expect(slots.acquire()).toBeNull()
  })
})

describe('createCopilotHookPluginSlots(書き直し。実 fs)', () => {
  it.skipIf(!POSIX)(
    '親・枠・hooks のフォルダを 0700、plugin.json・hooks.json を 0600 で作り、一時ファイルを残さない',
    async () => {
      const slots = slotsOf()
      const slot = slots.acquire()
      if (slot === null) throw new Error('枠が無い')
      const config = buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN })
      await slots.write(slot, config)
      expect([modeOf(rootDir), modeOf(slot.dir), modeOf(join(slot.dir, 'hooks'))]).toEqual([
        0o700, 0o700, 0o700
      ])
      expect(modeOf(join(slot.dir, 'plugin.json'))).toBe(0o600)
      expect(modeOf(hooksFileOf(slot.dir))).toBe(0o600)
      expect(JSON.parse(readFileSync(join(slot.dir, 'plugin.json'), 'utf8'))).toEqual(
        COPILOT_HOOK_PLUGIN_MANIFEST
      )
      expect(readFileSync(hooksFileOf(slot.dir), 'utf8')).toBe(JSON.stringify(config))
      expect(readdirSync(slot.dir).sort()).toEqual(['hooks', 'plugin.json'])
      expect(readdirSync(join(slot.dir, 'hooks'))).toEqual(['hooks.json'])
    }
  )

  it('2 回目の書き直しは hooks.json だけを新しいトークンに置き換え、フォルダの実体(inode)を保つ', async () => {
    const slots = slotsOf()
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    const inode = statSync(slot.dir).ino
    await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: OTHER_TOKEN }))
    expect(statSync(slot.dir).ino).toBe(inode)
    const text = readFileSync(hooksFileOf(slot.dir), 'utf8')
    expect(text).toContain(OTHER_TOKEN)
    expect(text).not.toContain(TOKEN)
    expect(readdirSync(join(slot.dir, 'hooks'))).toEqual(['hooks.json'])
  })

  it.skipIf(!POSIX)(
    'グループ・他人も書ける(0777)枠のフォルダは使わず、消して 0700 で作り直す(L-437)',
    async () => {
      const slots = slotsOf()
      const slot = slots.acquire()
      if (slot === null) throw new Error('枠が無い')
      mkdirSync(rootDir, { mode: 0o700 })
      mkdirSync(slot.dir)
      chmodSync(slot.dir, 0o777)
      writeFileSync(join(slot.dir, 'planted.txt'), 'x')
      await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
      expect(modeOf(slot.dir)).toBe(0o700)
      expect(existsSync(join(slot.dir, 'planted.txt'))).toBe(false)
      expect(existsSync(hooksFileOf(slot.dir))).toBe(true)
    }
  )

  it.skipIf(!POSIX)(
    '枠のフォルダがシンボリックリンクなら、リンクだけを消して実体のフォルダを作り直す(リンク先は変えない。L-016)',
    async () => {
      const slots = slotsOf()
      const slot = slots.acquire()
      if (slot === null) throw new Error('枠が無い')
      const target = join(dir, 'elsewhere')
      mkdirSync(target, { mode: 0o700 })
      writeFileSync(join(target, 'keep.txt'), 'keep')
      mkdirSync(rootDir, { mode: 0o700 })
      symlinkSync(target, slot.dir)
      await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
      expect(lstatSync(slot.dir).isSymbolicLink()).toBe(false)
      expect(lstatSync(slot.dir).isDirectory()).toBe(true)
      expect(readdirSync(target)).toEqual(['keep.txt'])
    }
  )

  it.skipIf(!POSIX)(
    'hooks のフォルダがシンボリックリンクなら、リンクだけを消して実体のフォルダに hooks.json を書く(リンク先には書かない。L-016)',
    async () => {
      const slots = slotsOf()
      const slot = slots.acquire()
      if (slot === null) throw new Error('枠が無い')
      await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
      const hooksDir = join(slot.dir, 'hooks')
      const target = join(dir, 'elsewhere-hooks')
      mkdirSync(target, { mode: 0o700 })
      writeFileSync(join(target, 'keep.txt'), 'keep')
      removeTempPathSync(hooksDir)
      symlinkSync(target, hooksDir)
      await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: OTHER_TOKEN }))
      expect(lstatSync(hooksDir).isSymbolicLink()).toBe(false)
      expect(modeOf(hooksDir)).toBe(0o700)
      expect(readFileSync(hooksFileOf(slot.dir), 'utf8')).toContain(OTHER_TOKEN)
      expect(readdirSync(target)).toEqual(['keep.txt'])
    }
  )

  it.skipIf(!POSIX)(
    'グループ・他人も書ける(0777)hooks のフォルダは使わず、消して 0700 で作り直す(L-437)',
    async () => {
      const slots = slotsOf()
      const slot = slots.acquire()
      if (slot === null) throw new Error('枠が無い')
      await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
      const hooksDir = join(slot.dir, 'hooks')
      chmodSync(hooksDir, 0o777)
      writeFileSync(join(hooksDir, 'planted.txt'), 'x')
      await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: OTHER_TOKEN }))
      expect(modeOf(hooksDir)).toBe(0o700)
      expect(readdirSync(hooksDir)).toEqual(['hooks.json'])
      expect(readFileSync(hooksFileOf(slot.dir), 'utf8')).toContain(OTHER_TOKEN)
    }
  )

  it.skipIf(!POSIX)(
    '親のフォルダ(agent-hooks-copilot)の確かめに外れたら、作り直さずに reject する(ほかの枠の hooks.json を消さない。L-004)',
    async () => {
      const slots = slotsOf()
      const first = slots.acquire()
      const second = slots.acquire()
      if (first === null || second === null) throw new Error('枠が無い')
      await slots.write(first, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
      chmodSync(rootDir, 0o777)
      await expect(
        slots.write(second, buildCopilotHookConfig({ baseUrl: BASE, token: OTHER_TOKEN }))
      ).rejects.toThrow()
      expect(existsSync(hooksFileOf(first.dir))).toBe(true)
      expect(existsSync(second.dir)).toBe(false)
      chmodSync(rootDir, 0o700)
    }
  )

  it('rename が失敗したら自分の一時ファイルだけを消して reject する(ほかの .tmp は残す。例外にトークンを入れない)', async () => {
    const slots = slotsOf({
      renameFile: async (from, to) => {
        if (to.endsWith('hooks.json')) throw new Error('EPERM')
        await rename(from, to)
      }
    })
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    mkdirSync(join(slot.dir, 'hooks'), { recursive: true, mode: 0o700 })
    chmodSync(rootDir, 0o700)
    writeFileSync(join(slot.dir, 'hooks', '.foreign.tmp'), 'x')
    const error = await slots
      .write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
      .then(
        () => null,
        (err: unknown) => err
      )
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain(TOKEN)
    expect(readdirSync(join(slot.dir, 'hooks'))).toEqual(['.foreign.tmp'])
  })

  it('一時ファイルの名前が既にあれば(EEXIST)そのファイルを消さずに reject する(L-004)', async () => {
    const slots = slotsOf({ createTempName: () => '.taken.tmp' })
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    mkdirSync(join(slot.dir, 'hooks'), { recursive: true, mode: 0o700 })
    chmodSync(rootDir, 0o700)
    // 正しい plugin.json を先に置いて plugin.json を書かない経路にし、EEXIST を hooks.json の一時ファイルだけにする
    // (plugin.json の一時ファイルは slot.dir に作るので、hooks/.taken.tmp とは衝突しない)
    writeFileSync(
      join(slot.dir, 'plugin.json'),
      `${JSON.stringify(COPILOT_HOOK_PLUGIN_MANIFEST, null, 2)}\n`,
      { mode: 0o600 }
    )
    writeFileSync(join(slot.dir, 'hooks', '.taken.tmp'), 'other')
    await expect(
      slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(join(slot.dir, 'hooks', '.taken.tmp'), 'utf8')).toBe('other')
  })
})

describe('createCopilotHookPluginSlots(アプリの終了)', () => {
  it('removeTokenFilesSync はすべての枠の hooks.json だけを消し、plugin.json とフォルダは残す。以後の書き直しは reject', async () => {
    const slots = slotsOf()
    const first = slots.acquire()
    const second = slots.acquire()
    if (first === null || second === null) throw new Error('枠が無い')
    await slots.write(first, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    await slots.write(second, buildCopilotHookConfig({ baseUrl: BASE, token: OTHER_TOKEN }))
    slots.release(second)
    slots.removeTokenFilesSync()
    for (const slot of [first, second]) {
      expect(existsSync(hooksFileOf(slot.dir))).toBe(false)
      expect(existsSync(join(slot.dir, 'plugin.json'))).toBe(true)
      expect(existsSync(join(slot.dir, 'hooks'))).toBe(true)
    }
    await expect(
      slots.write(first, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    ).rejects.toThrow('copilot の hooks のフォルダは終了処理で閉じられています')
  })

  it('書き直しの最中に removeTokenFilesSync が来たら、書き終えた hooks.json をその場で消して reject する(L-435)', async () => {
    const gate = deferred()
    const renameCalled = deferred()
    const slots = slotsOf({
      renameFile: async (from, to) => {
        if (to.endsWith('hooks.json')) {
          renameCalled.resolve()
          await gate.promise
        }
        await rename(from, to)
      }
    })
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    const writing = slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    await renameCalled.promise
    slots.removeTokenFilesSync()
    gate.resolve()
    await expect(writing).rejects.toThrow('copilot の hooks のフォルダは終了処理で閉じられています')
    expect(existsSync(hooksFileOf(slot.dir))).toBe(false)
  })

  it('hooks.json を消せなくても投げず、パスだけをログに出して残りの枠を続ける(L-010)', () => {
    const removed: string[] = []
    const slots = slotsOf({
      rmSync: (target) => {
        removed.push(target)
        if (target.includes('slot-1')) throw new Error('EBUSY')
      }
    })
    expect(() => slots.removeTokenFilesSync()).not.toThrow()
    expect(removed).toHaveLength(COPILOT_HOOK_PLUGIN_SLOT_COUNT)
    expect(warnSpy).toHaveBeenCalledWith(
      '[agent-hooks] copilot の hooks の設定のファイルを消せませんでした:',
      hooksFileOf(join(rootDir, 'slot-1'))
    )
  })
})

describe('createCopilotHookPluginSlots(plugin.json は無いか中身が違うときだけ書く)', () => {
  const renamedNamesOf = (renamed: string[]): string[] => renamed.map((target) => basename(target))
  const recordingSlots = (renamed: string[]): CopilotHookPluginSlots =>
    slotsOf({
      renameFile: async (from, to) => {
        renamed.push(to)
        await rename(from, to)
      }
    })

  it('plugin.json が無いときは書く', async () => {
    const renamed: string[] = []
    const slots = recordingSlots(renamed)
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    expect(renamedNamesOf(renamed)).toEqual(['plugin.json', 'hooks.json'])
    expect(readFileSync(join(slot.dir, 'plugin.json'), 'utf8')).toBe(
      `${JSON.stringify(COPILOT_HOOK_PLUGIN_MANIFEST, null, 2)}\n`
    )
  })

  it('同じ中身の plugin.json があれば書かない(置き換えを呼ばず、mtime と inode が変わらない)', async () => {
    const renamed: string[] = []
    const slots = recordingSlots(renamed)
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    const manifestPath = join(slot.dir, 'plugin.json')
    const before = statSync(manifestPath)
    renamed.length = 0
    await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: OTHER_TOKEN }))
    const after = statSync(manifestPath)
    expect(renamedNamesOf(renamed)).toEqual(['hooks.json'])
    expect([after.mtimeMs, after.ino]).toEqual([before.mtimeMs, before.ino])
  })

  it('違う中身の plugin.json は書き直す', async () => {
    const renamed: string[] = []
    const slots = recordingSlots(renamed)
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    mkdirSync(join(slot.dir, 'hooks'), { recursive: true, mode: 0o700 })
    chmodSync(rootDir, 0o700)
    chmodSync(slot.dir, 0o700)
    const manifestPath = join(slot.dir, 'plugin.json')
    writeFileSync(manifestPath, '{"name":"other"}\n', { mode: 0o600 })
    await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    expect(renamedNamesOf(renamed)).toEqual(['plugin.json', 'hooks.json'])
    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual(COPILOT_HOOK_PLUGIN_MANIFEST)
  })
})

describe('createCopilotHookPluginSlots(フォルダの作成の競合。EEXIST の後に lstat し直す)', () => {
  // 確かめてから作るまでの間に、別の書き直しが先にフォルダを作った場合を、作成の差し替えで再現する
  const racingSlots = (racerMode: number): CopilotHookPluginSlots =>
    slotsOf({
      makeDir: async (target, options) => {
        if (target.endsWith('slot-1')) {
          await mkdir(target, { mode: 0o700 })
          chmodSync(target, racerMode)
          const err: NodeJS.ErrnoException = new Error('EEXIST')
          err.code = 'EEXIST'
          throw err
        }
        return mkdir(target, options)
      }
    })

  it('先に作られたフォルダが自分の 0700 なら、そのまま使って書き終える', async () => {
    const slots = racingSlots(0o700)
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    await slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    expect(existsSync(hooksFileOf(slot.dir))).toBe(true)
  })

  it.skipIf(!POSIX)('先に作られたフォルダが 0777 なら、使わずに reject する', async () => {
    const slots = racingSlots(0o777)
    const slot = slots.acquire()
    if (slot === null) throw new Error('枠が無い')
    await expect(
      slots.write(slot, buildCopilotHookConfig({ baseUrl: BASE, token: TOKEN }))
    ).rejects.toThrow('copilot の hooks のフォルダの持ち主・権限が正しくありません')
    expect(existsSync(hooksFileOf(slot.dir))).toBe(false)
  })
})
