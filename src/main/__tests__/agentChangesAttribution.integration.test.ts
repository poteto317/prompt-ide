import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AgentBaselineRegistry } from '../agentBaselineRegistry'
import {
  removeBaselineDir,
  removeBaselineDirSync,
  takeBaselineSnapshot
} from '../agentBaselineSnapshot'
import { collectAgentChangeEntries, collectAgentChangeEntriesBetween } from '../agentChangesQuery'
import type { AgentChangesRecord } from '../agentChangesRecord'
import type { AgentToolActivitySignal } from '../agentToolActivity'
import { commitAll, runGit } from './helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  createFakeAttributionSource,
  disposeAgentBaselineRepo,
  FAKE_INSTANCE_ID,
  makeFakeProtectionDeps,
  userRepoState
} from './helpers/agentBaselineFixtures'
import type { AgentBaselineRepo, FakeAttributionSource } from './helpers/agentBaselineFixtures'

// 記録の区別を実 git(takeBaselineSnapshot・collectAgentChangeEntriesBetween)で通す(設計書「テスト方針」段階 B の実 git の結合)。
// 追跡は偽物(合図を書き換えて notifyAttributionSignal を呼ぶ)。claude は起動しない

describe('記録の利用者の変更との区別(実 git)', () => {
  let dirs: AgentBaselineRepo
  let source: FakeAttributionSource
  let registry: AgentBaselineRegistry

  beforeEach(() => {
    dirs = createAgentBaselineRepo('agent-attribution-int-')
    writeFileSync(join(dirs.repo, 'a.txt'), 'a\n')
    writeFileSync(join(dirs.repo, 'b.txt'), 'b\n')
    commitAll(dirs.repo, 'init')
    source = createFakeAttributionSource({ phase: 'idle' })
    registry = new AgentBaselineRegistry({
      takeSnapshot: (folderPath, options) =>
        takeBaselineSnapshot(folderPath, {
          ...options,
          tempRoot: dirs.tempRoot,
          instanceId: FAKE_INSTANCE_ID
        }),
      collectBetween: (start, end) => collectAgentChangeEntriesBetween(start, end),
      collectCurrent: (snapshot) => collectAgentChangeEntries(snapshot),
      removeDir: removeBaselineDir,
      removeDirSync: removeBaselineDirSync,
      now: Date.now,
      protection: makeFakeProtectionDeps(),
      executeUndo: async () => {
        throw new Error('このファイルのテストは取り消しを使わない')
      },
      attributionSource: source,
      attributionDevLog: null,
      attributionWarn: () => undefined
    })
  })

  afterEach(() => {
    registry.close()
    disposeAgentBaselineRepo(dirs)
  })

  const change = (next: Partial<AgentToolActivitySignal>): void => {
    source.set(next)
    registry.notifyAttributionSignal(1)
  }
  /** 並んでいる同期を走らせ終えてから記録を受ける */
  const recordNow = async (): Promise<AgentChangesRecord> => {
    const record = await registry.withRecord(1, dirs.repo, async (r) => r)
    if (record === null) throw new Error('記録が無い')
    return record
  }
  /** 受け口と同じく、段階を agent にしてから区切りを待つ */
  const toolStarts = async (): Promise<void> => {
    source.seq += 1
    change({ phase: 'agent' })
    await registry.waitForAgentPhase(1, new AbortController().signal)
  }

  it('idle の間の利用者の変更は利用者の集合に、agent の間のエージェントの変更はエージェントの集合に入る(パスは git の表記)', async () => {
    await registry.begin(1, dirs.repo, 'manual')
    writeFileSync(join(dirs.repo, 'a.txt'), 'user\n')
    await toolStarts()
    writeFileSync(join(dirs.repo, 'b.txt'), 'agent\n')
    mkdirSync(join(dirs.repo, 'new'))
    writeFileSync(join(dirs.repo, 'new', 'c.txt'), 'c\n')
    change({ phase: 'idle' })
    const record = await recordNow()
    expect(record.attribution).toMatchObject({
      kind: 'tracking',
      phase: 'idle',
      userPaths: new Set(['a.txt']),
      agentPaths: new Set(['b.txt', 'new/c.txt'])
    })
  })

  it('判定の区切りの object が gc で消えたら、次の同期で区別をやめる(lost・checkpoint-failed。それまでの印は残る)', async () => {
    await registry.begin(1, dirs.repo, 'manual')
    writeFileSync(join(dirs.repo, 'a.txt'), 'user\n')
    await toolStarts()
    writeFileSync(join(dirs.repo, 'a.txt'), 'agent\n')
    // 判定の区切りは保護の ref で守らない(設計書「判定の区切りの持ち方」)
    runGit(dirs.repo, 'gc', '-q', '--prune=now')
    change({ phase: 'idle' })
    const record = await recordNow()
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      reason: 'checkpoint-failed',
      userPaths: new Set(['a.txt'])
    })
  })

  it('判定の区切りを取っても、利用者の .git/index・HEAD・refs・stash は変わらない', async () => {
    const before = userRepoState(dirs.repo)
    await registry.begin(1, dirs.repo, 'manual')
    writeFileSync(join(dirs.repo, 'a.txt'), 'user\n')
    await toolStarts()
    writeFileSync(join(dirs.repo, 'b.txt'), 'agent\n')
    change({ phase: 'idle' })
    await recordNow()
    expect(userRepoState(dirs.repo)).toEqual(before)
  })
})
