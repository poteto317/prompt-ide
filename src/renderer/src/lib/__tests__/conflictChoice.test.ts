import { describe, it, expect } from 'vitest'
import { CHOICE_TARGET } from '../conflictChoice'
import type { ConflictChoice } from '@shared/types'

describe('CHOICE_TARGET', () => {
  it('ours / theirs / both の各選択肢に対する日本語文言が定義されている', () => {
    expect(CHOICE_TARGET.ours).toBe('自分の内容に')
    expect(CHOICE_TARGET.theirs).toBe('相手の内容に')
    expect(CHOICE_TARGET.both).toBe('両方に')
  })

  it('すべての ConflictChoice キーを網羅している', () => {
    const keys: ConflictChoice[] = ['ours', 'theirs', 'both']
    for (const key of keys) {
      expect(CHOICE_TARGET[key]).toBeDefined()
      expect(typeof CHOICE_TARGET[key]).toBe('string')
    }
  })
})
