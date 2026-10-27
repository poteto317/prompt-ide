import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { AGENT_HOOK_EVENT_NAMES } from '../agentHookProtocol'
import {
  AGENT_HOOK_SETTINGS_DIR_PREFIX,
  buildAgentHookSettings,
  createAgentHookSettingsDir,
  isOwnPrivateDirStat,
  removeAgentHookSettingsFile,
  writeAgentHookSettingsFile
} from '../agentHookSettings'
import type { AgentHookSettingsDirStat } from '../agentHookSettings'
import { removeTempPathSync } from './helpers/tempDirGuard'

const TOKEN = 'ab'.repeat(32)
const BASE = 'http://127.0.0.1:43210'
const MATCHER = 'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell'
const hook = (
  segment: string,
  timeout = 5
): { type: string; url: string; headers: { Authorization: string }; timeout: number } => ({
  type: 'http',
  url: `${BASE}/prompt-ide/agent-hooks/v1/${segment}`,
  headers: { Authorization: `Bearer ${TOKEN}` },
  timeout
})

let warnSpy: MockInstance<typeof console.warn>
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  warnSpy.mockRestore()
})

/** 実 fs を使う describe だけが呼ぶ。テストごとに一時ディレクトリを作って消し、そのパスを返す関数を返す */
function useTempDir(): () => string {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-hook-settings-'))
  })
  afterEach(() => {
    // 準備が失敗して空のままなら消さない
    if (dir !== '') removeTempPathSync(dir)
  })
  return () => dir
}

describe('buildAgentHookSettings', () => {
  it('9 つのイベントの http の hook を完全一致の形で返す(SessionStart は渡さない。PostToolBatch は matcher なし・timeout 5)', () => {
    expect(buildAgentHookSettings({ baseUrl: BASE, token: TOKEN })).toStrictEqual({
      hooks: {
        UserPromptSubmit: [{ hooks: [hook('user-prompt-submit')] }],
        PreToolUse: [{ matcher: MATCHER, hooks: [hook('pre-tool-use', 10)] }],
        PostToolUse: [{ matcher: MATCHER, hooks: [hook('post-tool-use')] }],
        PostToolUseFailure: [{ matcher: MATCHER, hooks: [hook('post-tool-use-failure')] }],
        PostToolBatch: [{ hooks: [hook('post-tool-batch')] }],
        SubagentStop: [{ hooks: [hook('subagent-stop')] }],
        Stop: [{ hooks: [hook('stop')] }],
        StopFailure: [{ hooks: [hook('stop-failure')] }],
        SessionEnd: [{ hooks: [hook('session-end')] }]
      }
    })
  })

  it('JSON の並びはイベントの列挙の順で、onFailure・async・if を付けない', () => {
    const settings = buildAgentHookSettings({ baseUrl: BASE, token: TOKEN })
    expect(Object.keys(settings.hooks)).toEqual([...AGENT_HOOK_EVENT_NAMES])
    expect(JSON.stringify(settings)).not.toMatch(/onFailure|"async"|"if"/)
  })
})

describe('writeAgentHookSettingsFile', () => {
  const tempDir = useTempDir()

  it('トークンと無関係な 32 桁の 16 進の名前で、0600 の JSON を書いて絶対パスを返す', async () => {
    const settings = buildAgentHookSettings({ baseUrl: BASE, token: TOKEN })
    const path = await writeAgentHookSettingsFile(tempDir(), settings)
    expect(path.startsWith(tempDir())).toBe(true)
    expect(basename(path)).toMatch(/^[0-9a-f]{32}\.json$/)
    expect(path).not.toContain(TOKEN)
    // --settings の値が JSON の文字列・オプションと取り違えられない(L-034)
    expect(path.startsWith('-')).toBe(false)
    expect(path.startsWith('{')).toBe(false)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toStrictEqual(settings)
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('同じ名前のファイルが既にあれば失敗し、そのファイルを上書きも削除もしない(wx。L-004)', async () => {
    const existing = join(tempDir(), `${'c'.repeat(32)}.json`)
    writeFileSync(existing, 'other')
    await expect(
      writeAgentHookSettingsFile(
        tempDir(),
        buildAgentHookSettings({ baseUrl: BASE, token: TOKEN }),
        () => 'c'.repeat(32)
      )
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(existing, 'utf8')).toBe('other')
  })
})

describe('removeAgentHookSettingsFile', () => {
  const tempDir = useTempDir()

  it('ファイルを消す', async () => {
    const path = join(tempDir(), 'a.json')
    writeFileSync(path, '{}')
    await removeAgentHookSettingsFile(path)
    expect(existsSync(path)).toBe(false)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('無いファイルでも投げず、ログも出さない', async () => {
    await expect(
      removeAgentHookSettingsFile(join(tempDir(), 'missing.json'))
    ).resolves.toBeUndefined()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('消せなければ投げずに、パスだけをログに出す', async () => {
    const path = join(tempDir(), 'not-empty')
    mkdirSync(path)
    writeFileSync(join(path, 'x'), 'x')
    await expect(removeAgentHookSettingsFile(path)).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith('[agent-hooks] 設定のファイルを消せませんでした:', path)
  })
})

describe('createAgentHookSettingsDir(実 fs)', () => {
  const tempDir = useTempDir()

  it('最初の ensure で 0700 のディレクトリを作り、2 回目(同時の呼び出しを含む)は同じパスを返す', async () => {
    const settingsDir = createAgentHookSettingsDir({ tmpdir: tempDir })
    const [first, concurrent] = await Promise.all([settingsDir.ensure(), settingsDir.ensure()])
    expect(concurrent).toBe(first)
    expect(await settingsDir.ensure()).toBe(first)
    expect(basename(first).startsWith(AGENT_HOOK_SETTINGS_DIR_PREFIX)).toBe(true)
    if (process.platform !== 'win32') expect(statSync(first).mode & 0o777).toBe(0o700)
  })

  it('作ったディレクトリが外から消されていたら、次の ensure で作り直して新しいパスを返す', async () => {
    const settingsDir = createAgentHookSettingsDir({ tmpdir: tempDir })
    const first = await settingsDir.ensure()
    removeTempPathSync(first)
    const [second, concurrent] = await Promise.all([settingsDir.ensure(), settingsDir.ensure()])
    expect(second).not.toBe(first)
    expect(concurrent).toBe(second)
    expect(existsSync(second)).toBe(true)
    expect(await settingsDir.ensure()).toBe(second)
    settingsDir.removeSync()
    expect(existsSync(second)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    '作ったパスが他の人も書ける(0777)ディレクトリになっていたら、そこを使わずに作り直す',
    async () => {
      const settingsDir = createAgentHookSettingsDir({ tmpdir: tempDir })
      const first = await settingsDir.ensure()
      chmodSync(first, 0o777)
      const second = await settingsDir.ensure()
      expect(second).not.toBe(first)
      expect(statSync(second).mode & 0o777).toBe(0o700)
      removeTempPathSync(first)
    }
  )

  it.skipIf(process.platform === 'win32')(
    '作ったパスがシンボリックリンクに差し替えられていたら、リンク先を使わずに作り直す',
    async () => {
      const settingsDir = createAgentHookSettingsDir({ tmpdir: tempDir })
      const first = await settingsDir.ensure()
      const elsewhere = mkdtempSync(join(tempDir(), 'elsewhere-'))
      chmodSync(elsewhere, 0o700)
      removeTempPathSync(first)
      symlinkSync(elsewhere, first)
      const second = await settingsDir.ensure()
      expect(second).not.toBe(first)
      expect(lstatSync(second).isSymbolicLink()).toBe(false)
    }
  )

  const leftovers = (dir: string): string[] =>
    readdirSync(dir).filter((name) => name.startsWith(AGENT_HOOK_SETTINGS_DIR_PREFIX))

  it('removeSync の後の ensure は reject し、ディレクトリを作らない(will-quit の後に残さない)', async () => {
    const settingsDir = createAgentHookSettingsDir({ tmpdir: tempDir })
    const created = await settingsDir.ensure()
    settingsDir.removeSync()
    expect(existsSync(created)).toBe(false)
    await expect(settingsDir.ensure()).rejects.toThrow()
    expect(leftovers(tempDir())).toEqual([])
  })

  it('ensure の mkdtemp の最中に removeSync が来ても、その ensure は reject し、できたディレクトリは消える', async () => {
    const settingsDir = createAgentHookSettingsDir({ tmpdir: tempDir })
    const pending = settingsDir.ensure()
    settingsDir.removeSync()
    await expect(pending).rejects.toThrow()
    expect(leftovers(tempDir())).toEqual([])
    await expect(settingsDir.ensure()).rejects.toThrow()
    expect(leftovers(tempDir())).toEqual([])
  })

  it('removeSync は中のファイルごとディレクトリを消す', async () => {
    const settingsDir = createAgentHookSettingsDir({ tmpdir: tempDir })
    const created = await settingsDir.ensure()
    writeFileSync(join(created, 'a.json'), '{}')
    settingsDir.removeSync()
    expect(existsSync(created)).toBe(false)
  })
})

describe('createAgentHookSettingsDir', () => {
  it('mkdtemp は 1 回だけ。失敗したら次の ensure で作り直す', async () => {
    const mkdtemp = vi
      .fn<(prefix: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValueOnce('/tmp/prompt-ide-agent-hooks-abc')
    const settingsDir = createAgentHookSettingsDir({
      mkdtemp,
      isPrivateDir: async () => true,
      tmpdir: () => '/tmp'
    })
    await expect(settingsDir.ensure()).rejects.toThrow('EACCES')
    await expect(settingsDir.ensure()).resolves.toBe('/tmp/prompt-ide-agent-hooks-abc')
    await settingsDir.ensure()
    expect(mkdtemp).toHaveBeenCalledTimes(2)
    expect(mkdtemp).toHaveBeenCalledWith(join('/tmp', 'prompt-ide-agent-hooks-'))
  })

  const dirWithFailingRmSync = (): {
    settingsDir: ReturnType<typeof createAgentHookSettingsDir>
    rmSyncFake: ReturnType<typeof vi.fn>
  } => {
    const rmSyncFake = vi.fn(() => {
      throw new Error('EBUSY')
    })
    const settingsDir = createAgentHookSettingsDir({
      mkdtemp: async () => '/tmp/prompt-ide-agent-hooks-x',
      isPrivateDir: async () => true,
      rmSync: rmSyncFake,
      tmpdir: () => '/tmp'
    })
    return { settingsDir, rmSyncFake }
  }

  it('mkdtemp の完了前に removeSync が来たら、できたディレクトリを rmSync で消して reject する(失敗はパスをログ)', async () => {
    let finish: (dir: string) => void = () => undefined
    const rmSyncFake = vi.fn(() => {
      throw new Error('EBUSY')
    })
    const settingsDir = createAgentHookSettingsDir({
      mkdtemp: () => new Promise<string>((resolve) => (finish = resolve)),
      isPrivateDir: async () => true,
      rmSync: rmSyncFake,
      tmpdir: () => '/tmp'
    })
    const pending = settingsDir.ensure()
    settingsDir.removeSync()
    expect(rmSyncFake).not.toHaveBeenCalled()
    finish('/tmp/prompt-ide-agent-hooks-late')
    await expect(pending).rejects.toThrow()
    expect(rmSyncFake).toHaveBeenCalledExactlyOnceWith('/tmp/prompt-ide-agent-hooks-late', {
      recursive: true,
      force: true
    })
    expect(warnSpy).toHaveBeenCalledWith(
      '[agent-hooks] 設定のディレクトリを消せませんでした:',
      '/tmp/prompt-ide-agent-hooks-late'
    )
  })

  it('isPrivateDir の待ちの間に removeSync が来たら、作り直さず reject する', async () => {
    let release: (value: boolean) => void = () => undefined
    const mkdtemp = vi.fn(async () => '/tmp/prompt-ide-agent-hooks-a')
    const settingsDir = createAgentHookSettingsDir({
      mkdtemp,
      isPrivateDir: () => new Promise<boolean>((resolve) => (release = resolve)),
      rmSync: vi.fn(),
      tmpdir: () => '/tmp'
    })
    await settingsDir.ensure().catch(() => undefined)
    const second = settingsDir.ensure()
    await Promise.resolve()
    await Promise.resolve()
    settingsDir.removeSync()
    release(false)
    await expect(second).rejects.toThrow()
    expect(mkdtemp).toHaveBeenCalledTimes(1)
  })

  it('作れていなければ removeSync は何もしない', () => {
    const { settingsDir, rmSyncFake } = dirWithFailingRmSync()
    settingsDir.removeSync()
    expect(rmSyncFake).not.toHaveBeenCalled()
  })

  it('消す失敗は投げずにパスをログに出す', async () => {
    const { settingsDir, rmSyncFake } = dirWithFailingRmSync()
    await settingsDir.ensure()
    expect(() => settingsDir.removeSync()).not.toThrow()
    expect(rmSyncFake).toHaveBeenCalledWith('/tmp/prompt-ide-agent-hooks-x', {
      recursive: true,
      force: true
    })
    expect(warnSpy).toHaveBeenCalledWith(
      '[agent-hooks] 設定のディレクトリを消せませんでした:',
      '/tmp/prompt-ide-agent-hooks-x'
    )
  })
})

describe('isOwnPrivateDirStat', () => {
  const stat = (
    over: Partial<{ dir: boolean; link: boolean; uid: number; mode: number }> = {}
  ): AgentHookSettingsDirStat => {
    const { dir = true, link = false, uid = 501, mode = 0o40700 } = over
    return { isDirectory: () => dir, isSymbolicLink: () => link, uid, mode }
  }

  it('自分の持ち物で、グループ・他人の権限が無いディレクトリだけを使える', () => {
    expect(isOwnPrivateDirStat(stat(), { platform: 'darwin', uid: 501 })).toBe(true)
    expect(isOwnPrivateDirStat(stat({ uid: 1000 }), { platform: 'linux', uid: 501 })).toBe(false)
    expect(isOwnPrivateDirStat(stat({ mode: 0o40770 }), { platform: 'linux', uid: 501 })).toBe(
      false
    )
    expect(isOwnPrivateDirStat(stat({ mode: 0o40701 }), { platform: 'linux', uid: 501 })).toBe(
      false
    )
    expect(isOwnPrivateDirStat(stat({ dir: false }), { platform: 'linux', uid: 501 })).toBe(false)
    expect(isOwnPrivateDirStat(stat({ link: true }), { platform: 'linux', uid: 501 })).toBe(false)
  })

  it('Windows では持ち主と権限を見ず、シンボリックリンクでないディレクトリなら使える', () => {
    expect(
      isOwnPrivateDirStat(stat({ uid: 0, mode: 0o40777 }), { platform: 'win32', uid: null })
    ).toBe(true)
    expect(isOwnPrivateDirStat(stat({ link: true }), { platform: 'win32', uid: null })).toBe(false)
  })
})
