import { describe, it, expect } from 'vitest'
import { AGENT_CHANGES_UNAVAILABLE_REASONS } from '@shared/types'
import {
  AGENT_CHANGES_UNAVAILABLE_MESSAGES,
  buildAgentChangesHeading,
  buildAgentRevertAllConfirmMessage,
  buildAgentRevertFileConfirmMessage,
  buildAgentRevertHunkConfirmMessage,
  describeAgentChangesUnavailable,
  formatAgentChangesListedNotice,
  formatAgentChangesMore,
  formatAgentChangesRevertedNotice,
  formatAgentChangesStartedAt
} from '../agentChangesMessages'

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
