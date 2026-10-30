import { describe, it, expect } from 'vitest'
import { AgentBaselineProtectionSync } from '../agentBaselineProtectionSync'
import type { AgentChangesRecord } from '../agentChangesRecord'
import {
  createFakeProtectionGit,
  makeAgentChangesRecord,
  makeBaselineSnapshot,
  makeFakeProtectionDeps
} from './helpers/agentBaselineFixtures'
import type { FakeProtectionGit } from './helpers/agentBaselineFixtures'

// AgentBaselineProtectionSync 単体のテスト。registry を通した振る舞い(いつ同期が並ぶか)は agentBaselineRegistry.test.ts の
// 「保護の ref」で見る。ここは 1 回の同期の分岐(作る・更新・消す・何もしない・読み直しの分類・終了時の同期の削除)を直接固定する

const TB = 'a'.repeat(40)

function recordOf(
  serial: number,
  overrides: { gitDir?: string | null; tree?: string } = {}
): AgentChangesRecord {
  return makeAgentChangesRecord([], {
    recordSerial: serial,
    baseline: makeBaselineSnapshot({
      tempDir: `/tmp/rec${serial}`,
      tree: overrides.tree ?? TB,
      gitDir: overrides.gitDir ?? null
    })
  })
}

function setup(): {
  sync: AgentBaselineProtectionSync
  git: FakeProtectionGit
  /** 所有者 → 今の記録(registry の records の代わり) */
  current: Map<number, AgentChangesRecord>
  close: () => void
} {
  const git = createFakeProtectionGit()
  const current = new Map<number, AgentChangesRecord>()
  let closed = false
  const sync = new AgentBaselineProtectionSync(makeFakeProtectionDeps(git), {
    isClosed: () => closed,
    currentRecordOf: (ownerId) => current.get(ownerId),
    currentRecords: () => current.values()
  })
  return {
    sync,
    git,
    current,
    close: () => {
      closed = true
    }
  }
}

// 今の記録として登録して 1 回同期する
async function protect(
  s: ReturnType<typeof setup>,
  ownerId: number,
  record: AgentChangesRecord
): Promise<void> {
  s.current.set(ownerId, record)
  s.sync.registerOwner(record, ownerId)
  await s.sync.sync(ownerId, record)
}

describe('AgentBaselineProtectionSync', () => {
  it('今の記録は、掃除してから項目の tree で ref を作り、書けた値を記録に残す', async () => {
    const s = setup()
    const record = recordOf(1)
    await protect(s, 1, record)
    expect(s.git.calls).toEqual([
      'filter',
      'mktree',
      'sweep',
      `create ${record.protection.refName}`
    ])
    expect(s.git.refs.get(record.protection.refName)).toBe(`tree(baseline=${TB})`)
    expect(record.protection.value).toBe(`tree(baseline=${TB})`)
    expect(record.protection.swept).toBe(true)
  })

  it('あるべき値が前に書けた値と同じなら ref を書かない', async () => {
    const s = setup()
    const record = recordOf(1)
    await protect(s, 1, record)
    s.git.calls.length = 0
    await s.sync.sync(1, record)
    expect(s.git.calls).toEqual(['filter', 'mktree'])
  })

  it('掃除は記録ごとに初めて作るときの 1 回だけ行う(更新では掃除しない)', async () => {
    const s = setup()
    const record = recordOf(1)
    await protect(s, 1, record)
    record.baseline = { ...record.baseline, tree: 'b'.repeat(40) }
    s.git.calls.length = 0
    await s.sync.sync(1, record)
    expect(s.git.calls).toEqual(['filter', 'mktree', `update ${record.protection.refName}`])
  })

  it('今の記録でなくなった記録の ref は消す', async () => {
    const s = setup()
    const record = recordOf(1)
    await protect(s, 1, record)
    s.current.delete(1)
    await s.sync.sync(1, record)
    expect(s.git.refs.has(record.protection.refName)).toBe(false)
    expect(record.protection.value).toBeNull()
  })

  it('項目の tree が object の DB に 1 つも無ければ何もしない', async () => {
    const s = setup()
    const record = recordOf(1)
    s.git.missingTrees.add(TB)
    await protect(s, 1, record)
    expect(s.git.calls).toEqual(['filter'])
    expect(record.protection.value).toBeNull()
  })

  it('隠れた git の記録(gitDir が文字列)は git を呼ばない', async () => {
    const s = setup()
    const record = recordOf(1, { gitDir: '/tmp/rec1/git' })
    await protect(s, 1, record)
    expect(s.git.calls).toEqual([])
  })

  it('cat-file(filter)の失敗は投げる(呼び出し側が握って次の同期で試し直す)', async () => {
    const s = setup()
    const record = recordOf(1)
    s.git.failNext.add('filter')
    await expect(protect(s, 1, record)).rejects.toThrow('偽物の filter の失敗')
    expect(record.protection.value).toBeNull()
  })

  describe('書き込みの失敗の後の読み直し', () => {
    it('読み直した値があるべき値なら書けたとみなす', async () => {
      const s = setup()
      const record = recordOf(1)
      // 作成は失敗したが、ref は既にあるべき値になっている
      s.git.refs.set(record.protection.refName, `tree(baseline=${TB})`)
      await protect(s, 1, record)
      expect(s.git.calls).toContain(`read ${record.protection.refName}`)
      expect(record.protection.value).toBe(`tree(baseline=${TB})`)
    })

    it('前に書いた値のまま(作るときは無いまま)なら次の同期で試し直す', async () => {
      const s = setup()
      const record = recordOf(1)
      s.git.failNext.add('create')
      await protect(s, 1, record)
      expect(record.protection.value).toBeNull()
      await s.sync.sync(1, record)
      expect(s.git.refs.get(record.protection.refName)).toBe(`tree(baseline=${TB})`)
    })

    it('利用者が書き換えていたら保護をやめ、以後は作り直さず、掃除でもその番号を残す', async () => {
      const s = setup()
      const record = recordOf(1)
      await protect(s, 1, record)
      s.git.refs.set(record.protection.refName, 'user-value')
      record.baseline = { ...record.baseline, tree: 'b'.repeat(40) }
      await s.sync.sync(1, record)
      expect(s.git.refs.get(record.protection.refName)).toBe('user-value')
      s.git.calls.length = 0
      await s.sync.sync(1, record)
      expect(s.git.calls).toEqual([])
      // 別の記録の初回作成の掃除で、保護をやめた番号 1 を残す番号に含める
      s.current.delete(1)
      await protect(s, 2, recordOf(2))
      expect(s.git.sweptKeeps.at(-1)).toEqual([1, 2])
    })

    it('読み直し自体が失敗したら何も変えない', async () => {
      const s = setup()
      const record = recordOf(1)
      s.git.failNext.add('create')
      s.git.failNext.add('read')
      await protect(s, 1, record)
      expect(record.protection.value).toBeNull()
      // 保護はやめていないので、次の同期で作れる
      await s.sync.sync(1, record)
      expect(s.git.refs.has(record.protection.refName)).toBe(true)
    })
  })

  it('同じ所有者の同期のたびに、消せずに残った捨てた記録の ref の削除を試し直す(他の所有者のものは試さない)', async () => {
    const s = setup()
    const old = recordOf(1)
    const other = recordOf(2)
    await protect(s, 1, old)
    await protect(s, 2, other)
    // 所有者 1 の記録を置き換え、古い記録の削除を 1 回失敗させる
    const next = recordOf(3)
    s.current.set(1, next)
    s.sync.registerOwner(next, 1)
    s.git.failNext.add('remove')
    await s.sync.sync(1, old)
    expect(s.git.refs.has(old.protection.refName)).toBe(true)
    // 所有者 1 の次の同期(新しい記録)で、古い記録の削除を試し直す
    s.git.calls.length = 0
    await s.sync.sync(1, next)
    expect(s.git.refs.has(old.protection.refName)).toBe(false)
    expect(s.git.calls).not.toContain(`remove ${other.protection.refName}`)
    expect(s.git.refs.has(other.protection.refName)).toBe(true)
  })

  it('掃除で残す番号は、今の記録と ref を作れた記録(削除待ちを含む)の番号', async () => {
    const s = setup()
    const first = recordOf(1)
    await protect(s, 1, first)
    // 所有者 1 の記録 1 は捨てたが、ref の削除はまだ(protected のまま)
    s.current.delete(1)
    await protect(s, 2, recordOf(5))
    expect(s.git.sweptKeeps.at(-1)).toEqual([1, 5])
  })

  describe('終了', () => {
    it('removeAllSync は ref を作れた記録の ref を同期で消し、1 つが失敗しても残りを試す', async () => {
      const s = setup()
      const a = recordOf(1)
      const b = recordOf(2)
      await protect(s, 1, a)
      await protect(s, 2, b)
      s.git.failNext.add('removeSync')
      s.close()
      s.sync.removeAllSync()
      expect(s.git.calls.filter((call) => call.startsWith('removeSync'))).toHaveLength(2)
      // 1 つ目は失敗して残り、2 つ目は消えた
      expect(s.git.refs.size).toBe(1)
      expect([a, b].filter((record) => record.protection.value === null)).toHaveLength(1)
    })

    it('終了中は同期しない', async () => {
      const s = setup()
      s.close()
      await protect(s, 1, recordOf(1))
      expect(s.git.calls).toEqual([])
    })

    it('ref を作っている途中に終了したら、作れた時点でその場で同期で消す', async () => {
      const s = setup()
      const record = recordOf(1)
      const release = s.git.holdNext('create')
      const pending = protect(s, 1, record)
      await expect
        .poll(() => s.git.calls.includes(`create ${record.protection.refName}`))
        .toBe(true)
      s.close()
      release()
      await pending
      expect(s.git.calls.at(-1)).toBe(`removeSync ${record.protection.refName}`)
      expect(s.git.refs.has(record.protection.refName)).toBe(false)
      expect(record.protection.value).toBeNull()
    })
  })
})
