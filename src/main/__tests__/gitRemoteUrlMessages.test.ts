import { describe, it, expect } from 'vitest'
import { getRemoteUrlRuleViolation } from '@shared/remoteUrl'
import type { RemoteUrlRuleViolation } from '@shared/remoteUrl'
import { REMOTE_URL_RULE_MESSAGES } from '../gitRemoteUrlMessages'

// 違反の種類ごとに、その違反になる URL。判定(@shared/remoteUrl)が実際に返す種類から表を引く。表の型
// (Record)はコンパイル時の網羅しか固定しないため、実行時にも全種類に文言があることを確かめる
const SAMPLES: [RemoteUrlRuleViolation, string][] = [
  ['empty', ''],
  ['too-long', `https://example.com/${'a'.repeat(5000)}`],
  ['invalid-char', 'https://example.com/a b'],
  ['leading-dash', '--upload-pack=touch'],
  ['unsupported', 'ext::sh']
]

describe('REMOTE_URL_RULE_MESSAGES', () => {
  it.each(SAMPLES)('%s の違反に、空でない文言がある', (kind, url) => {
    expect(getRemoteUrlRuleViolation(url, { windowsPaths: false })).toBe(kind)
    expect(REMOTE_URL_RULE_MESSAGES[kind]).toEqual(expect.any(String))
    expect(REMOTE_URL_RULE_MESSAGES[kind]).not.toBe('')
  })

  it('表のキーは違反の種類と過不足なく一致する', () => {
    expect(Object.keys(REMOTE_URL_RULE_MESSAGES).sort()).toEqual(
      SAMPLES.map(([kind]) => kind).sort()
    )
  })
})
