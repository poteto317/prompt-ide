import { describe, it, expect } from 'vitest'
import { AGENT_CHANGES_UNAVAILABLE_REASONS } from '@shared/types'
import type { AgentChangesRunAvailability } from '@shared/types'
import {
  AGENT_CHANGES_RUN_EMPTY,
  AGENT_CHANGES_RUN_HEAD_CHANGED,
  AGENT_CHANGES_RUN_UNAVAILABLE_SHORT,
  AGENT_CHANGES_SCOPE_LABEL,
  AGENT_CHANGES_UNAVAILABLE_MESSAGES,
  buildAgentChangesHeading,
  buildAgentChangesRunHeading,
  describeAgentChangesScopeUnavailable,
  formatAgentChangesAllScopeOption,
  formatAgentChangesRunOption,
  buildAgentRevertAllConfirmMessage,
  buildAgentRevertFileConfirmMessage,
  buildAgentRevertHunkConfirmMessage,
  describeAgentChangesUnavailable,
  formatAgentChangesListedNotice,
  formatAgentChangesMore,
  formatAgentChangesRevertedNotice,
  formatAgentChangesStartedAt
} from '../agentChangesMessages'
import { makeAgentChangesRun } from '../../__tests__/makeAgentChangesState'

const at = (hours: number, minutes: number): number =>
  new Date(2026, 9, 7, hours, minutes).getTime()

describe('記録できない理由', () => {
  it.each(AGENT_CHANGES_UNAVAILABLE_REASONS)('%s には文言がある', (reason) => {
    expect(describeAgentChangesUnavailable({ kind: 'unavailable', reason })).toBe(
      AGENT_CHANGES_UNAVAILABLE_MESSAGES[reason]
    )
  })

  it('未追跡が多すぎるときは件数と合計を添える', () => {
    expect(
      describeAgentChangesUnavailable({
        kind: 'unavailable',
        reason: 'too-many-untracked',
        untrackedCount: 5001,
        untrackedBytes: 0
      })
    ).toBe(
      '未追跡のファイルが多すぎるため、記録できません。.gitignore を確かめてください（5,001 件）'
    )
    expect(
      describeAgentChangesUnavailable({
        kind: 'unavailable',
        reason: 'too-many-untracked',
        untrackedCount: 21,
        untrackedBytes: 105 * 1024 * 1024
      })
    ).toBe(
      '未追跡のファイルが多すぎるため、記録できません。.gitignore を確かめてください（21 件・105.0 MB）'
    )
  })
})

describe('見出しと通知', () => {
  it('記録なしは見出しだけ、記録中は開始の時刻、変更があれば件数を添える', () => {
    expect(buildAgentChangesHeading(null)).toBe('エージェントの変更')
    expect(buildAgentChangesHeading({ startedAt: at(10, 42), totalCount: null })).toBe(
      'エージェントの変更（10:42 から）'
    )
    expect(buildAgentChangesHeading({ startedAt: at(10, 42), totalCount: 0 })).toBe(
      'エージェントの変更（10:42 から）'
    )
    expect(buildAgentChangesHeading({ startedAt: at(9, 5), totalCount: 3 })).toBe(
      'エージェントの変更 (3)（09:05 から）'
    )
  })

  it('時刻は 0 埋めの HH:MM', () => {
    expect(formatAgentChangesStartedAt(at(0, 7))).toBe('00:07')
  })

  it('打ち切り・取得・戻した結果の文言', () => {
    expect(formatAgentChangesMore(12)).toBe('ほか 12 件')
    expect(formatAgentChangesListedNotice(3)).toBe('エージェントの変更: 3 件')
    expect(formatAgentChangesRevertedNotice(2)).toBe('2 件を実行前の状態に戻しました')
  })
})

describe('確認の文言', () => {
  const plain = { savedInApp: false, hasUnsavedEdits: false, agentRunning: false }

  it.each([
    [
      'M',
      false,
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。この操作は元に戻せません。'
    ],
    [
      'D',
      false,
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。この操作は元に戻せません。'
    ],
    [
      'T',
      false,
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。この操作は元に戻せません。'
    ],
    ['A', false, 'a.txt をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）'],
    [
      'A',
      true,
      'a.txt をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。'
    ]
  ] as const)('ファイル単位 %s(フォルダ %s)', (status, isDirectory, expected) => {
    expect(
      buildAgentRevertFileConfirmMessage({ path: 'a.txt', status, isDirectory, ...plain })
    ).toBe(expected)
  })

  it('追記はアプリでの保存 → 未保存の編集 → エージェントの動作の順に、空行で区切って足す', () => {
    expect(
      buildAgentRevertFileConfirmMessage({
        path: 'a.txt',
        status: 'M',
        isDirectory: false,
        savedInApp: true,
        hasUnsavedEdits: true,
        agentRunning: true
      }).split('\n\n')
    ).toEqual([
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。この操作は元に戻せません。',
      'このファイルは、記録を始めた後にアプリで保存されています。',
      'エディタの未保存の編集も破棄されます。',
      'エージェントが動いている間は、戻した後に同じファイルが書き換えられることがあります。'
    ])
  })

  it('ハンク', () => {
    expect(
      buildAgentRevertHunkConfirmMessage({
        path: 'a.txt',
        hunkHeader: '@@ -1,3 +1,4 @@',
        ...plain,
        hasUnsavedEdits: true
      })
    ).toBe(
      'a.txt の次のハンクを実行前の状態に戻しますか？この操作は元に戻せません。\n\n@@ -1,3 +1,4 @@\n\nエディタの未保存の編集も破棄されます。'
    )
  })

  it('すべて', () => {
    expect(
      buildAgentRevertAllConfirmMessage({
        count: 3,
        trashCount: 1,
        savedInApp: false,
        agentRunning: false
      })
    ).toBe(
      'エージェントの変更 3 件を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。この操作は元に戻せません。\nうち 1 件の新しいファイル・フォルダはゴミ箱へ移動します。\nステージ（index）・コミット・ブランチは戻しません。'
    )
    expect(
      buildAgentRevertAllConfirmMessage({
        count: 2,
        trashCount: 0,
        savedInApp: true,
        agentRunning: true
      })
    ).toBe(
      'エージェントの変更 2 件を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。この操作は元に戻せません。\nステージ（index）・コミット・ブランチは戻しません。\n\n記録を始めた後にアプリで保存したファイルを含みます。\n\nエージェントが動いている間は、戻した後に同じファイルが書き換えられることがあります。'
    )
  })
})

describe('範囲の項目・見出し・理由の文言', () => {
  it('累積の項目は開始の時刻を添える', () => {
    expect(formatAgentChangesAllScopeOption(at(10, 42))).toBe('すべて（累積・10:42 から）')
  })

  it.each<[string, ReturnType<typeof makeAgentChangesRun>, string]>([
    [
      '選べる最後の実行',
      makeAgentChangesRun({ number: 3, startedAt: at(11, 5) }),
      '実行 3（11:05 から）'
    ],
    [
      '選べる途中の実行',
      makeAgentChangesRun({ number: 1, startedAt: at(10, 42), endedAt: at(10, 50) }),
      '実行 1（10:42〜10:50）'
    ],
    [
      '開始を記録できなかった実行',
      makeAgentChangesRun({
        number: 3,
        startedAt: at(11, 5),
        availability: { kind: 'start-not-recorded', reason: 'too-many-untracked' }
      }),
      '実行 3（11:05・開始の状態を記録できませんでした: 未追跡のファイルが多すぎます）'
    ],
    [
      '終わりを記録できなかった実行',
      makeAgentChangesRun({
        number: 2,
        startedAt: at(10, 50),
        endedAt: at(11, 5),
        availability: { kind: 'end-not-recorded' }
      }),
      '実行 2（10:50〜・次の実行の開始を記録できなかったため比べられません）'
    ]
  ])('%s の項目', (_label, run, expected) => {
    expect(formatAgentChangesRunOption(run)).toBe(expected)
  })

  it('未知の選べるかの種類は、選べる実行の項目の文字に流さず例外にする', () => {
    const run = makeAgentChangesRun({
      availability: { kind: 'pending' } as unknown as AgentChangesRunAvailability
    })
    expect(() => formatAgentChangesRunOption(run)).toThrow('未知の実行の選べるかの種類です')
  })

  it('開始を記録できなかった理由の短い形は、記録できない理由をすべて網羅する', () => {
    expect(AGENT_CHANGES_RUN_UNAVAILABLE_SHORT).toEqual({
      'not-repository': 'Git 管理外のフォルダです',
      'not-toplevel': 'リポジトリの最上位のフォルダではありません',
      'too-many-untracked': '未追跡のファイルが多すぎます',
      timeout: '時間がかかりすぎました',
      'git-failed': 'git を実行できませんでした'
    })
  })

  it('実行の範囲の見出しは、件数(1 件以上のとき)と実行の番号・期間を添える', () => {
    expect(
      buildAgentChangesRunHeading(makeAgentChangesRun({ number: 3, startedAt: at(11, 5) }), 2)
    ).toBe('エージェントの変更 (2)（実行 3・11:05 から）')
    expect(
      buildAgentChangesRunHeading(
        makeAgentChangesRun({ number: 1, startedAt: at(10, 42), endedAt: at(10, 50) }),
        0
      )
    ).toBe('エージェントの変更（実行 1・10:42〜10:50）')
    expect(
      buildAgentChangesRunHeading(makeAgentChangesRun({ number: 1, startedAt: at(10, 42) }), null)
    ).toBe('エージェントの変更（実行 1・10:42 から）')
  })

  it('実行の範囲の空の文言・HEAD の帯・選択のラベル', () => {
    expect(AGENT_CHANGES_RUN_EMPTY).toBe('この実行では、変わったファイルはありません')
    expect(AGENT_CHANGES_RUN_HEAD_CHANGED).toBe(
      'この実行の間に HEAD が変わりました（コミット・ブランチの切り替えなど）'
    )
    expect(AGENT_CHANGES_SCOPE_LABEL).toBe('表示')
  })

  it('範囲の一覧が取れない理由は、選択の項目と同じ理由', () => {
    const failedRun = makeAgentChangesRun({
      availability: { kind: 'start-not-recorded', reason: 'timeout' }
    })
    expect(describeAgentChangesScopeUnavailable('start-not-recorded', failedRun)).toBe(
      '開始の状態を記録できませんでした: 時間がかかりすぎました'
    )
    expect(describeAgentChangesScopeUnavailable('start-not-recorded', undefined)).toBe(
      '開始の状態を記録できませんでした'
    )
    expect(describeAgentChangesScopeUnavailable('end-not-recorded', undefined)).toBe(
      '次の実行の開始を記録できなかったため比べられません'
    )
  })

  it.each(
    Object.keys(
      AGENT_CHANGES_RUN_UNAVAILABLE_SHORT
    ) as (keyof typeof AGENT_CHANGES_RUN_UNAVAILABLE_SHORT)[]
  )(
    '開始を記録できなかった理由(%s)は、選択の項目と一覧が取れない理由で同じ文字になる',
    (reason) => {
      const run = makeAgentChangesRun({
        number: 4,
        startedAt: at(9, 0),
        availability: { kind: 'start-not-recorded', reason }
      })
      const text = describeAgentChangesScopeUnavailable('start-not-recorded', run)
      expect(formatAgentChangesRunOption(run)).toBe(`実行 4（09:00・${text}）`)
    }
  )
})
