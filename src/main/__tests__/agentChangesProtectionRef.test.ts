import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProtectionGitContext } from '../agentChangesProtectionRef'
import {
  createProtectionRef,
  deleteProtectionRef,
  deleteProtectionRefSync,
  filterExistingProtectionTrees,
  isOwnProtectionTreeListing,
  isProcessAliveOnThisMachine,
  parseBatchCheckOutput,
  parseProtectionRefListing,
  makeProtectionTree,
  prepareAgentChangesNoHooksDir,
  readProtectionRef,
  sweepStaleProtectionRefs,
  updateProtectionRef
} from '../agentChangesProtectionRef'
import { runBaselineGitWithInput, runBaselineGitWithInputSync } from '../agentBaselineGit'

// git の実行はモックにして、入力の検証(git を呼ぶ前に弾く)と出力の解釈だけを確かめる
vi.mock('../agentBaselineGit', () => ({
  runBaselineGitWithInput: vi.fn(),
  runBaselineGitWithInputSync: vi.fn()
}))

const T1 = 'a'.repeat(40)
const T2 = 'b'.repeat(40)
// ls-tree -z の 1 行
const lsEntry = (type: string, name: string, sha = T1): string =>
  `${type === 'tree' ? '040000' : '100644'} ${type} ${sha}\t${name}\0`

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(runBaselineGitWithInput).mockReset()
  vi.mocked(runBaselineGitWithInputSync).mockReset()
})

const ctx: ProtectionGitContext = { folderPath: '/repo', indexPath: '/idx', noHooksDir: '/hooks' }
const REF = 'refs/prompt-ide/agent-changes/123-0abcdef1/4'

describe('parseBatchCheckOutput', () => {
  const entries = [
    { name: 'baseline', tree: T1 },
    { name: 'run-2', tree: T2 }
  ]
  it('tree と答えた項目だけを残す(missing・tree 以外は除く)', () => {
    expect(parseBatchCheckOutput(`${T1} tree 40\n${T2} missing\n`, entries)).toEqual([entries[0]])
    expect(parseBatchCheckOutput(`${T1} blob 3\n${T2} tree 9\n`, entries)).toEqual([entries[1]])
  })
  it('行の数・ID が入力と合わなければ例外(空の出力を「無い」と読まない。L-002)', () => {
    expect(() => parseBatchCheckOutput('', entries)).toThrow()
    expect(() => parseBatchCheckOutput(`${T2} tree 9\n${T1} tree 40\n`, entries)).toThrow()
  })
})

describe('parseProtectionRefListing', () => {
  it('1 行を名前・値・種類に分け、形の違う行は飛ばす', () => {
    const output = `refs/prompt-ide/agent-changes/1-00000000/1\0${T1}\0tree\nbroken-line\n`
    expect(parseProtectionRefListing(output)).toEqual([
      { refName: 'refs/prompt-ide/agent-changes/1-00000000/1', value: T1, objectType: 'tree' }
    ])
    expect(parseProtectionRefListing('')).toEqual([])
  })
})

describe('isOwnProtectionTreeListing(形の崩れ)', () => {
  it('タブが無い行は、git の出力の形が違うものとして false(後ろに正しい行があっても)', () => {
    expect(
      isOwnProtectionTreeListing(`040000 tree ${T1}baseline\0${lsEntry('tree', 'run-1')}`)
    ).toBe(false)
  })
})

describe('保護の ref の操作の入力検証(git を呼ぶ前に弾く)', () => {
  const git = vi.mocked(runBaselineGitWithInput)
  const gitSync = vi.mocked(runBaselineGitWithInputSync)

  it('filterExistingProtectionTrees: 項目が空なら git を呼ばず空配列を返す', async () => {
    await expect(filterExistingProtectionTrees(ctx, [])).resolves.toEqual([])
    expect(git).not.toHaveBeenCalled()
  })

  it('形の違う名前(自分が作った形でない)の ref は create・update・delete・read のどれも拒否する', async () => {
    const bad = 'refs/heads/main'
    await expect(createProtectionRef(ctx, bad, T1)).rejects.toThrow('保護の ref の名前が不正です')
    await expect(updateProtectionRef(ctx, bad, T1, T2)).rejects.toThrow('名前が不正')
    await expect(deleteProtectionRef(ctx, bad, T1)).rejects.toThrow('名前が不正')
    await expect(readProtectionRef(ctx, bad)).rejects.toThrow('名前が不正')
    expect(git).not.toHaveBeenCalled()
  })

  it('object の ID の形でない値は create・update・delete・tree の作成・存在確認で拒否する', async () => {
    await expect(createProtectionRef(ctx, REF, 'zzz')).rejects.toThrow(
      'object の ID が不正です: zzz'
    )
    await expect(updateProtectionRef(ctx, REF, 'zzz', T2)).rejects.toThrow('ID が不正')
    await expect(updateProtectionRef(ctx, REF, T1, 'zzz')).rejects.toThrow('ID が不正')
    await expect(deleteProtectionRef(ctx, REF, 'zzz')).rejects.toThrow('ID が不正')
    await expect(makeProtectionTree(ctx, [{ name: 'baseline', tree: 'zzz' }])).rejects.toThrow(
      'ID が不正'
    )
    await expect(
      filterExistingProtectionTrees(ctx, [{ name: 'baseline', tree: 'zzz' }])
    ).rejects.toThrow('ID が不正')
    expect(git).not.toHaveBeenCalled()
  })

  it('makeProtectionTree: git の出力が object の ID でなければ例外にする', async () => {
    git.mockResolvedValueOnce('not-an-id\n')
    await expect(makeProtectionTree(ctx, [{ name: 'baseline', tree: T1 }])).rejects.toThrow(
      'ID が不正'
    )
  })

  describe('deleteProtectionRefSync', () => {
    it('名前の形が違う・expected が object の ID でないときは、git を呼ばず false', () => {
      expect(deleteProtectionRefSync(ctx, 'refs/heads/main', T1)).toBe(false)
      expect(deleteProtectionRefSync(ctx, REF, 'zzz')).toBe(false)
      expect(gitSync).not.toHaveBeenCalled()
    })
    it('正しい入力なら同期の git の結果をそのまま返す', () => {
      gitSync.mockReturnValueOnce(true)
      expect(deleteProtectionRefSync(ctx, REF, T1)).toBe(true)
      expect(gitSync).toHaveBeenCalledTimes(1)
    })
  })

  it('sweepStaleProtectionRefs: 一覧を取れなければ握って何も消さずに終わる(keepSerials も呼ばない)', async () => {
    git.mockRejectedValueOnce(new Error('git 失敗'))
    const keepSerials = vi.fn(() => new Set<number>())
    await expect(
      sweepStaleProtectionRefs(ctx, {
        instanceId: '1-00000000',
        keepSerials,
        isProcessAlive: () => false
      })
    ).resolves.toBeUndefined()
    expect(keepSerials).not.toHaveBeenCalled()
    expect(git).toHaveBeenCalledTimes(1)
  })

  describe('readProtectionRef', () => {
    it('出力が空なら null(無い)', async () => {
      git.mockResolvedValueOnce('')
      await expect(readProtectionRef(ctx, REF)).resolves.toBeNull()
    })
    it('1 行で object の ID ならその値', async () => {
      git.mockResolvedValueOnce(`${T1}\n`)
      await expect(readProtectionRef(ctx, REF)).resolves.toBe(T1)
    })
    it.each([
      ['2 行以上', `${T1}\n${T2}\n`],
      ['1 行だが ID の形でない', 'garbage\n']
    ])('%s なら読めなかったとして reject する(空と区別する。L-002)', async (_label, output) => {
      git.mockResolvedValueOnce(output)
      await expect(readProtectionRef(ctx, REF)).rejects.toThrow('保護の ref の値を読めませんでした')
    })
  })
})

describe('isOwnProtectionTreeListing', () => {
  it.each([
    ['baseline と run', lsEntry('tree', 'baseline') + lsEntry('tree', 'run-3'), true],
    ['run だけ(gc で始点が消えた後の値)', lsEntry('tree', 'run-3'), true],
    ['空', '', false],
    ['baseline が 2 つ', lsEntry('tree', 'baseline') + lsEntry('tree', 'baseline', T2), false],
    ['子の名前が違う', lsEntry('tree', 'other'), false],
    ['run の番号が 0 始まり', lsEntry('tree', 'run-01'), false],
    ['子が blob', lsEntry('blob', 'run-1'), false]
  ])('%s → %s', (_label, output, expected) => {
    expect(isOwnProtectionTreeListing(output)).toBe(expected)
  })
})

describe('isProcessAliveOnThisMachine', () => {
  it('自分の pid は生きている', () => {
    expect(isProcessAliveOnThisMachine(process.pid)).toBe(true)
  })
  it('ESRCH だけを死んでいるとみなす(EPERM は生きているとみなす)', () => {
    const kill = vi.spyOn(process, 'kill')
    kill.mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
    expect(isProcessAliveOnThisMachine(99999)).toBe(false)
    kill.mockImplementation(() => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' })
    })
    expect(isProcessAliveOnThisMachine(1)).toBe(true)
  })
})

describe('prepareAgentChangesNoHooksDir', () => {
  it('userData の下に 0700 の空のディレクトリを作り、そのパスを返す', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-nohooks-'))
    try {
      const dir = prepareAgentChangesNoHooksDir(root)
      expect(dir).toBe(join(root, 'agent-changes-no-hooks'))
      expect(statSync(dir).mode & 0o777).toBe(0o700)
      // 2 回目(起動のたび)も例外にしない
      expect(prepareAgentChangesNoHooksDir(root)).toBe(dir)
    } finally {
      removeTempPathSync(root)
    }
  })
  it('作れなくても例外にせずパスを返す(存在しない hooksPath でも hook は動かない。確認の結果 5)', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-nohooks-'))
    try {
      const file = join(root, 'file')
      writeFileSync(file, 'x')
      expect(prepareAgentChangesNoHooksDir(file)).toBe(join(file, 'agent-changes-no-hooks'))
    } finally {
      removeTempPathSync(root)
    }
  })
})
