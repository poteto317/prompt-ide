import { describe, it, expect } from 'vitest'
import type { PromptExecutionMode } from '@shared/types'
import {
  getResumeEntryDisabledReason,
  getResumeLastDisabledReason
} from '../agentResumeAvailability'
import type { AgentResumeTab } from '../agentResumeAvailability'

const ID = '11111111-1111-4111-8111-111111111111'
const tab = (overrides: Partial<AgentResumeTab> = {}): AgentResumeTab => ({
  label: 'claude 1',
  status: 'none',
  claudeSessionId: null,
  ...overrides
})

describe('getResumeLastDisabledReason(前回の続きから)', () => {
  it('起動の理由(フォルダ無し・方式の切り替えの途中)を最優先にする', () => {
    expect(
      getResumeLastDisabledReason({
        startDisabledReason: 'フォルダを開いてください',
        lastSession: { kind: 'found', claudeSessionId: ID },
        tabs: [tab()]
      })
    ).toBe('フォルダを開いてください')
  })

  it('取得中・記録が無いの理由', () => {
    expect(
      getResumeLastDisabledReason({
        startDisabledReason: null,
        lastSession: { kind: 'loading' },
        tabs: []
      })
    ).toBe('前回のセッションを確かめています')
    expect(
      getResumeLastDisabledReason({
        startDisabledReason: null,
        lastSession: { kind: 'none' },
        tabs: []
      })
    ).toBe('このフォルダで前回起動したセッションの記録がありません')
  })

  it.each(['starting', 'running'] as const)(
    '同じ ID のタブが %s なら、そのタブの名前を出す',
    (status) => {
      expect(
        getResumeLastDisabledReason({
          startDisabledReason: null,
          lastSession: { kind: 'found', claudeSessionId: ID },
          tabs: [tab(), tab({ label: 'claude 2', status, claudeSessionId: ID })]
        })
      ).toBe('前回のセッションは claude 2 で動いています')
    }
  )

  it('記録があり、同じ ID のタブが動いていなければ押せる(null)', () => {
    expect(
      getResumeLastDisabledReason({
        startDisabledReason: null,
        lastSession: { kind: 'found', claudeSessionId: ID },
        tabs: [tab({ status: 'exited', claudeSessionId: null })]
      })
    ).toBeNull()
  })
})

describe('getResumeEntryDisabledReason(このセッションで再開)', () => {
  const recorded = { claudeSessionId: ID, tabLabel: 'claude 1', folderPath: '/work' }
  const ok = {
    mode: 'agent-cli' as const,
    folderPath: '/work',
    recorded,
    startDisabledReason: null,
    addDisabledReason: null,
    tabs: [tab()]
  }

  it('押せるなら null', () => {
    expect(getResumeEntryDisabledReason(ok)).toBeNull()
  })

  it('上から順に最初に当たった理由を 1 つ出す', () => {
    const all = {
      ...ok,
      folderPath: '/other',
      startDisabledReason: '実行方式を切り替えています',
      addDisabledReason: 'タブは 4 つまでです（使わないタブを閉じると追加できます）',
      tabs: [tab({ label: 'claude 2', status: 'running' as const, claudeSessionId: ID })]
    }
    expect(getResumeEntryDisabledReason({ ...all, mode: null })).toBe('設定を読み込んでいます')
    expect(getResumeEntryDisabledReason({ ...all, mode: 'legacy' })).toBe(
      'エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）'
    )
    expect(getResumeEntryDisabledReason(all)).toBe(
      '記録したフォルダ（/work）を開いているときだけ再開できます'
    )
    expect(getResumeEntryDisabledReason({ ...all, folderPath: '/work' })).toBe(
      '実行方式を切り替えています'
    )
    expect(
      getResumeEntryDisabledReason({ ...all, folderPath: '/work', startDisabledReason: null })
    ).toBe('このセッションは claude 2 で動いています')
    expect(
      getResumeEntryDisabledReason({
        ...all,
        folderPath: '/work',
        startDisabledReason: null,
        tabs: [tab()]
      })
    ).toBe('タブは 4 つまでです（使わないタブを閉じると追加できます）')
  })

  it('未知の方式(方式を足したとき)をエージェント CLI 方式として押せるようにしない', () => {
    // 型の外の値(方式の列挙を足したときに、この関数を直し忘れた場合)
    const unknownMode = 'remote' as unknown as PromptExecutionMode
    expect(getResumeEntryDisabledReason({ ...ok, mode: unknownMode })).toBe(
      'エージェント CLI 方式でだけ再開できます（設定で切り替えると使えます）'
    )
  })

  it('フォルダを開いていなければ、記録したフォルダの理由', () => {
    expect(getResumeEntryDisabledReason({ ...ok, folderPath: null })).toBe(
      '記録したフォルダ（/work）を開いているときだけ再開できます'
    )
  })

  it('フォルダの比較は isSamePath(末尾の区切り・Windows の大文字小文字を無視する)', () => {
    expect(getResumeEntryDisabledReason({ ...ok, folderPath: '/work/' })).toBeNull()
    expect(
      getResumeEntryDisabledReason({
        ...ok,
        folderPath: 'c:\\work',
        recorded: { ...recorded, folderPath: 'C:\\Work' }
      })
    ).toBeNull()
  })
})
