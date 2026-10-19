import { describe, it, expect } from 'vitest'
import type { Stats } from 'node:fs'
import {
  AGENT_BASELINE_TEMP_DIR_PREFIX,
  baselineTempDirPrefix,
  isOwnBaselineTempDir,
  parseBaselineTempDirName,
  staleCandidatePidOf
} from '../agentBaselineTempSweep'

describe('記録の一時ディレクトリの名前', () => {
  it('接頭辞は prompt-ide-agent-baseline-、起動ごとの接頭辞は <接頭辞><instanceId>-', () => {
    expect(AGENT_BASELINE_TEMP_DIR_PREFIX).toBe('prompt-ide-agent-baseline-')
    expect(baselineTempDirPrefix('123-0a1b2c3d')).toBe('prompt-ide-agent-baseline-123-0a1b2c3d-')
  })

  it('作る側の名前(baselineTempDirPrefix + mkdtemp の 6 文字)を、掃除の側が自分の形の名前として読める(名前の規則は 1 つの接頭辞から)', () => {
    // 接頭辞は名前の照合の正規表現に埋め込むため、正規表現の特別な文字を含まない
    expect(AGENT_BASELINE_TEMP_DIR_PREFIX).toMatch(/^[a-z-]+$/)
    expect(parseBaselineTempDirName(`${baselineTempDirPrefix('4242-0a1b2c3d')}Ab12Cd`)).toEqual({
      pid: 4242,
      instanceId: '4242-0a1b2c3d'
    })
  })

  it('自分の形の名前なら pid と instanceId を返す', () => {
    expect(parseBaselineTempDirName('prompt-ide-agent-baseline-123-0a1b2c3d-Ab12Cd')).toEqual({
      pid: 123,
      instanceId: '123-0a1b2c3d'
    })
    expect(
      parseBaselineTempDirName('prompt-ide-agent-baseline-2147483647-ffffffff-zzzzzz')
    ).toEqual({
      pid: 2147483647,
      instanceId: '2147483647-ffffffff'
    })
  })

  it.each([
    ['古い形(pid を含まない)', 'prompt-ide-agent-baseline-Ab12Cd'],
    ['pid が 0', 'prompt-ide-agent-baseline-0-0a1b2c3d-Ab12Cd'],
    ['pid の先頭が 0', 'prompt-ide-agent-baseline-0123-0a1b2c3d-Ab12Cd'],
    ['pid が 11 桁', 'prompt-ide-agent-baseline-12345678901-0a1b2c3d-Ab12Cd'],
    ['pid が 2^31−1 を超える', 'prompt-ide-agent-baseline-2147483648-0a1b2c3d-Ab12Cd'],
    ['負の pid', 'prompt-ide-agent-baseline--1-0a1b2c3d-Ab12Cd'],
    ['16 進が大文字', 'prompt-ide-agent-baseline-123-0A1B2C3D-Ab12Cd'],
    ['16 進が 7 桁', 'prompt-ide-agent-baseline-123-0a1b2c3-Ab12Cd'],
    ['mkdtemp の文字が 5 文字', 'prompt-ide-agent-baseline-123-0a1b2c3d-Ab12C'],
    ['後ろに続く文字がある', 'prompt-ide-agent-baseline-123-0a1b2c3d-Ab12Cd-x'],
    ['取り消しの控えの接頭辞', 'prompt-ide-agent-undo-123-0a1b2c3d-Ab12Cd'],
    ['別の接頭辞', 'other-123-0a1b2c3d-Ab12Cd']
  ])('%s は null(触らない。L-020・L-046)', (_label, name) => {
    expect(parseBaselineTempDirName(name)).toBeNull()
  })
})

describe('staleCandidatePidOf(名前だけで決まる掃除の候補の条件)', () => {
  const own = '123-0a1b2c3d'

  it('自分の形の名前で、自分の instanceId でなければ確かめる pid を返す', () => {
    expect(staleCandidatePidOf('prompt-ide-agent-baseline-456-ffffffff-Ab12Cd', own)).toBe(456)
  })

  it('自分と同じ pid でも instanceId が違えば候補にする(pid の再利用。プロセスの有無は後で確かめる)', () => {
    expect(staleCandidatePidOf('prompt-ide-agent-baseline-123-ffffffff-Ab12Cd', own)).toBe(123)
  })

  it('自分の instanceId の名前は候補にしない(このインスタンスの記録。L-435)', () => {
    expect(staleCandidatePidOf('prompt-ide-agent-baseline-123-0a1b2c3d-Ab12Cd', own)).toBeNull()
  })

  it.each([
    ['古い形の名前', 'prompt-ide-agent-baseline-Ab12Cd'],
    ['取り消しの控えの接頭辞', 'prompt-ide-agent-undo-456-ffffffff-Ab12Cd']
  ])('%s は候補にしない', (_label, name) => {
    expect(staleCandidatePidOf(name, own)).toBeNull()
  })
})

describe('isOwnBaselineTempDir(自分のものの判定。L-437)', () => {
  const statOf = (
    overrides: Partial<{ dir: boolean; link: boolean; uid: number; mode: number }> = {}
  ): Pick<Stats, 'isDirectory' | 'isSymbolicLink' | 'uid' | 'mode'> => {
    const { dir = true, link = false, uid = 501, mode = 0o40700 } = overrides
    return { isDirectory: () => dir, isSymbolicLink: () => link, uid, mode }
  }
  const mac = { uid: 501, platform: 'darwin' as const }

  it('リンクでないディレクトリで、持ち主が自分で 0700 なら自分のもの', () => {
    expect(isOwnBaselineTempDir(statOf(), mac)).toBe(true)
  })

  it.each([
    ['シンボリックリンク', statOf({ dir: false, link: true })],
    // lstat では起きないが、stat の結果を渡されてもリンクを辿った先を自分のものとしない
    ['ディレクトリを指すシンボリックリンク', statOf({ dir: true, link: true })],
    ['ファイル', statOf({ dir: false })],
    ['持ち主が違う', statOf({ uid: 502 })],
    ['0755', statOf({ mode: 0o40755 })],
    ['0777', statOf({ mode: 0o40777 })]
  ])('%s は自分のものとしない', (_label, stat) => {
    expect(isOwnBaselineTempDir(stat, mac)).toBe(false)
  })

  it('Windows 以外で自分の uid が分からなければ自分のものとしない', () => {
    expect(isOwnBaselineTempDir(statOf(), { uid: null, platform: 'linux' })).toBe(false)
  })

  it('Windows はリンクでないディレクトリだけを見る(持ち主・モードを見ない)', () => {
    expect(
      isOwnBaselineTempDir(statOf({ uid: 0, mode: 0o40777 }), { uid: null, platform: 'win32' })
    ).toBe(true)
    expect(
      isOwnBaselineTempDir(statOf({ dir: false, link: true }), { uid: null, platform: 'win32' })
    ).toBe(false)
  })
})
