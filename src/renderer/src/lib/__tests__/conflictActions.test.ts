import { describe, it, expect } from 'vitest'
import type { ConflictFile, ConflictStages, ConflictUnparsableReason } from '@shared/types'
import { getConflictActions } from '../conflictActions'

const parsed = (stages: ConflictStages, withBlocks: boolean): ConflictFile => ({
  status: 'parsed',
  stages,
  eol: '\n',
  digests: withBlocks ? ['d0'] : [],
  segments: withBlocks
    ? [
        {
          kind: 'conflict',
          ours: ['a'],
          theirs: ['b'],
          oursLabel: 'HEAD',
          theirsLabel: 'feature'
        }
      ]
    : [{ kind: 'text', lines: ['a'] }]
})

const unparsable = (reason: ConflictUnparsableReason, stages: ConflictStages): ConflictFile => ({
  status: 'unparsable',
  reason,
  stages
})

const BOTH = { ours: true, theirs: true }
const OURS_ONLY = { ours: true, theirs: false } // 相手が削除(UD)
const THEIRS_ONLY = { ours: false, theirs: true } // 自分が削除(DU)
const NONE = { ours: false, theirs: false } // DD

describe('getConflictActions', () => {
  // UU / AA は両側。ブロックの有無は操作の出し分けに影響しない
  it.each([
    ['UU・ブロック有', parsed(BOTH, true)],
    ['UU・ブロック無', parsed(BOTH, false)]
  ])('%s: 両側 → 「すべて採用」と「解決済みにする」。残す・削除は出さない', (_n, file) => {
    expect(getConflictActions(file)).toEqual({
      wholeFile: true,
      keep: false,
      remove: false,
      markResolved: true
    })
  })

  it.each([
    ['UD(ours のみ)・ブロック有', parsed(OURS_ONLY, true)],
    ['UD(ours のみ)・ブロック無', parsed(OURS_ONLY, false)],
    ['DU(theirs のみ)・ブロック有', parsed(THEIRS_ONLY, true)],
    ['DU(theirs のみ)・ブロック無', parsed(THEIRS_ONLY, false)]
  ])('%s: 片側 → 「残す」「削除する」「解決済みにする」', (_n, file) => {
    expect(getConflictActions(file)).toEqual({
      wholeFile: false,
      keep: true,
      remove: true,
      markResolved: true
    })
  })

  it.each([
    ['DD・ブロック有', parsed(NONE, true)],
    ['DD・ブロック無', parsed(NONE, false)]
  ])('%s: 両側無し → 「削除する」と「解決済みにする」だけ(残すは必ず失敗する)', (_n, file) => {
    expect(getConflictActions(file)).toEqual({
      wholeFile: false,
      keep: false,
      remove: true,
      markResolved: true
    })
  })

  const reasons: ConflictUnparsableReason[] = ['binary', 'markers', 'not-regular', 'missing']
  const stageCases: [
    string,
    ConflictStages,
    { wholeFile: boolean; keep: boolean; remove: boolean }
  ][] = [
    ['両側', BOTH, { wholeFile: true, keep: false, remove: false }],
    ['ours のみ', OURS_ONLY, { wholeFile: false, keep: true, remove: true }],
    ['theirs のみ', THEIRS_ONLY, { wholeFile: false, keep: true, remove: true }],
    ['両側無し(DD)', NONE, { wholeFile: false, keep: false, remove: true }]
  ]

  // reason × stages の全組み合わせ(4 × 4)で、ほかの操作の出し分けは reason に依らないことも確かめる
  describe.each(reasons)('unparsable(%s)', (reason) => {
    it.each(stageCases)('%s', (_n, stages, expected) => {
      // 「解決済みにする」は作業ツリーにファイルがあれば出す(missing 以外)。markers は手編集で、
      // binary / not-regular は「すべて採用」の後に押して解決する(checkout --ours/--theirs は
      // ステージ 1/2/3 を残すため、add しないと未解決のまま)
      expect(getConflictActions(unparsable(reason, stages))).toEqual({
        ...expected,
        markResolved: reason !== 'missing'
      })
    })
  })

  it.each([
    ['binary', BOTH],
    ['not-regular', BOTH]
  ] as const)(
    'unparsable(%s)・両側: 「すべて採用」と「解決済みにする」が両方出る(採用 → 解決済みの順で解決できる)',
    (reason, stages) => {
      const actions = getConflictActions(unparsable(reason, stages))
      expect(actions.wholeFile).toBe(true)
      expect(actions.markResolved).toBe(true)
    }
  )

  it.each([BOTH, OURS_ONLY, THEIRS_ONLY, NONE])(
    'unparsable(missing)・stages %j: ファイルが無いので「解決済みにする」は出さない',
    (stages) => {
      expect(getConflictActions(unparsable('missing', stages)).markResolved).toBe(false)
    }
  )

  // サブモジュール(gitlink)は main がすべての解決操作を拒否する。checkout --ours/--theirs は
  // 何も変えず、続けて add すると自分側のコミットが黙って記録されるため、ボタンを 1 つも出さない
  it.each([
    ['両側', BOTH],
    ['ours のみ', OURS_ONLY],
    ['theirs のみ', THEIRS_ONLY],
    ['両側無し(DD)', NONE]
  ])('unparsable(submodule)・%s: 解決のボタンを 1 つも出さない', (_n, stages) => {
    expect(getConflictActions(unparsable('submodule', stages))).toEqual({
      wholeFile: false,
      keep: false,
      remove: false,
      markResolved: false
    })
  })
})
