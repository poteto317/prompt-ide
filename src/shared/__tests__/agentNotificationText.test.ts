import { describe, it, expect } from 'vitest'
import { agentNotificationText } from '../agentNotificationText'

describe('agentNotificationText', () => {
  it.each([
    [
      'permission',
      {
        title: 'claude 2: 許可待ち',
        body: 'ツールの実行の許可を待っています',
        announcement: 'claude 2 が許可待ちになりました'
      }
    ],
    [
      'confirm',
      {
        title: 'claude 2: 確認待ち',
        body: '選択を待っています',
        announcement: 'claude 2 が確認待ちになりました'
      }
    ],
    [
      'done',
      {
        title: 'claude 2: 作業が終わりました',
        body: '次の指示を待っています',
        announcement: 'claude 2 の作業が終わりました'
      }
    ]
  ] as const)('%s の題・本文・読み上げ', (kind, expected) => {
    expect(agentNotificationText(kind, 2)).toEqual(expected)
  })
})
