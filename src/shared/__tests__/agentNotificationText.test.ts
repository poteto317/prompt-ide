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
    expect(agentNotificationText(kind, 2, 'claude')).toEqual(expected)
  })

  it.each([
    ['permission', 'copilot 1: 許可待ち', 'copilot 1 が許可待ちになりました'],
    ['confirm', 'copilot 1: 確認待ち', 'copilot 1 が確認待ちになりました'],
    ['done', 'copilot 1: 作業が終わりました', 'copilot 1 の作業が終わりました']
  ] as const)(
    'copilot の %s は、題と読み上げに copilot の名前を使う',
    (kind, title, announcement) => {
      expect(agentNotificationText(kind, 1, 'copilot')).toMatchObject({ title, announcement })
    }
  )

  it.each(['permission', 'confirm', 'done'] as const)('%s の本文は種類で変わらない', (kind) => {
    expect(agentNotificationText(kind, 1, 'copilot').body).toBe(
      agentNotificationText(kind, 1, 'claude').body
    )
  })
})
