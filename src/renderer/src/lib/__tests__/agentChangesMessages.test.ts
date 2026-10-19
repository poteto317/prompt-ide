import { describe, it, expect } from 'vitest'
import { AGENT_CHANGES_UNAVAILABLE_REASONS } from '@shared/types'
import type { AgentChangesRunAvailability } from '@shared/types'
import {
  AGENT_CHANGES_APP_STORAGE_HINT,
  AGENT_CHANGES_APP_STORAGE_NOTE,
  AGENT_CHANGES_ATTRIBUTION_LOST_REASONS,
  AGENT_CHANGES_MIXED_MARK,
  AGENT_CHANGES_ONLY_USER_REASON,
  AGENT_CHANGES_USER_MARK,
  AGENT_REVERT_ALL_DISTINGUISHING_NOTE,
  agentChangeAuthorMark,
  describeAgentChangesAttribution,
  formatAgentChangesExcludedNote,
  isAgentChangesAttributionDistinguishing,
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
  formatAgentChangesStartedAt,
  buildAgentUndoConfirmMessage,
  formatAgentChangesHunkRevertedNotice,
  formatAgentChangesUndoBandText,
  formatAgentChangesUndoButtonLabel,
  formatAgentChangesUndoneNotice,
  formatAgentChangesUndoTarget,
  formatAgentRevertPartialWarning
} from '../agentChangesMessages'
import {
  makeAgentChangesLostSummary,
  makeAgentChangesRun,
  makeAgentChangesTrackingSummary,
  makeAgentChangesUndoSummary
} from '../../__tests__/makeAgentChangesState'

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

  it('Git 管理外のフォルダのファイルが多すぎるときは、リポジトリの初期化と .gitignore を勧め、件数と合計を添える', () => {
    expect(
      describeAgentChangesUnavailable({
        kind: 'unavailable',
        reason: 'too-many-files',
        untrackedCount: 5005,
        untrackedBytes: 0
      })
    ).toBe(
      'ファイルが多すぎるため、記録できません。リポジトリを初期化してコミットするか、.gitignore で記録しないファイルを指定してください（5,005 件）'
    )
    expect(
      describeAgentChangesUnavailable({
        kind: 'unavailable',
        reason: 'too-many-files',
        untrackedCount: 21,
        untrackedBytes: 105 * 1024 * 1024
      })
    ).toBe(
      'ファイルが多すぎるため、記録できません。リポジトリを初期化してコミットするか、.gitignore で記録しないファイルを指定してください（21 件・105.0 MB）'
    )
  })

  it('.git の中・bare リポジトリのフォルダの理由(パスを含めない。L-017)', () => {
    expect(describeAgentChangesUnavailable({ kind: 'unavailable', reason: 'inside-git-dir' })).toBe(
      'Git のデータのフォルダ（.git の中・bare リポジトリ）では、エージェントの変更を記録できません'
    )
  })

  it('起こらない状態での文言を固定する: not-repository の長い文言(区切りの not-repository は実行の availability の短い形で出るため、セクションには届かない)', () => {
    expect(describeAgentChangesUnavailable({ kind: 'unavailable', reason: 'not-repository' })).toBe(
      'Git 管理外のフォルダになったため、記録できません'
    )
  })

  it('記録の置き場の注記の文言', () => {
    expect(AGENT_CHANGES_APP_STORAGE_NOTE).toBe(
      'Git 管理外のフォルダのため、アプリの一時領域に記録しています（node_modules などは記録しません）'
    )
    expect(AGENT_CHANGES_APP_STORAGE_HINT).toBe(
      'Git 管理外のフォルダのため、記録はアプリの一時領域に置きます（node_modules などは記録しません）'
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

  it('打ち切り・取得の文言', () => {
    expect(formatAgentChangesMore(12)).toBe('ほか 12 件')
    expect(formatAgentChangesListedNotice(3)).toBe('エージェントの変更: 3 件')
  })
})

describe('確認の文言', () => {
  const plain = { author: null, savedInApp: false, hasUnsavedEdits: false, agentRunning: false }

  it.each([
    [
      'M',
      false,
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
    ],
    [
      'D',
      false,
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
    ],
    [
      'T',
      false,
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
    ],
    [
      'A',
      false,
      'a.txt をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
    ],
    [
      'A',
      true,
      'a.txt をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。'
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
        author: null,
        savedInApp: true,
        hasUnsavedEdits: true,
        agentRunning: true
      }).split('\n\n')
    ).toEqual([
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。',
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
      'a.txt の次のハンクを実行前の状態に戻しますか？戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。\n\n@@ -1,3 +1,4 @@\n\nエディタの未保存の編集も破棄されます。'
    )
  })

  it('すべて', () => {
    expect(
      buildAgentRevertAllConfirmMessage({
        count: 3,
        trashCount: 1,
        hasDirectory: false,
        savedInApp: false,
        agentRunning: false,
        attribution: makeAgentChangesTrackingSummary(),
        startedAt: at(10, 0),
        excludedCount: 0
      })
    ).toBe(
      'エージェントの変更 3 件を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。\nうち 1 件の新しいファイル・フォルダはゴミ箱へ移動します。\nステージ（index）・コミット・ブランチは戻しません。'
    )
    expect(
      buildAgentRevertAllConfirmMessage({
        count: 2,
        trashCount: 0,
        hasDirectory: false,
        savedInApp: true,
        agentRunning: true,
        attribution: makeAgentChangesTrackingSummary(),
        startedAt: at(10, 0),
        excludedCount: 0
      })
    ).toBe(
      'エージェントの変更 2 件を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。\nステージ（index）・コミット・ブランチは戻しません。\n\n記録を始めた後にアプリで保存したファイルを含みます。\n\nエージェントが動いている間は、戻した後に同じファイルが書き換えられることがあります。'
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
      'too-many-files': 'ファイルが多すぎます',
      'inside-git-dir': 'Git のデータのフォルダです',
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

describe('取り消し', () => {
  const saved = { kind: 'saved' } as const
  it.each([
    [{ kind: 'unavailable', reason: 'directory' }, 'フォルダを含む'],
    [{ kind: 'unavailable', reason: 'unsupported-type' }, 'ファイル以外のものを含む'],
    [{ kind: 'unavailable', reason: 'too-large' }, '内容が大きすぎる'],
    [{ kind: 'unavailable', reason: 'capture-failed' }, '戻した後の状態を控えられなかった']
  ] as const)('戻した結果: 取れなかった理由 %j → %s', (undo, reason) => {
    expect(formatAgentChangesRevertedNotice(2, undo)).toBe(
      `2 件を実行前の状態に戻しました。${reason}ため、この操作は取り消せません`
    )
    expect(formatAgentChangesHunkRevertedNotice(undo)).toBe(
      `ハンクを実行前の状態に戻しました。${reason}ため、この操作は取り消せません`
    )
    expect(formatAgentRevertPartialWarning('途中で失敗', 1, undo)).toBe(
      `途中で失敗。${reason}ため、戻せた 1 件は取り消せません`
    )
  })
  it('戻した結果: 取れた', () => {
    expect(formatAgentChangesRevertedNotice(1, saved)).toBe(
      '1 件を実行前の状態に戻しました。「戻した操作を取り消す」で取り消せます'
    )
    expect(formatAgentChangesHunkRevertedNotice(saved)).toBe(
      'ハンクを実行前の状態に戻しました。ソース管理の「エージェントの変更」で取り消せます'
    )
    expect(formatAgentRevertPartialWarning('途中で失敗', 1, saved)).toBe(
      '途中で失敗。戻せた 1 件は「戻した操作を取り消す」で取り消せます'
    )
  })
  it('戻した結果: 控えを付けずに消した(discarded)なら、戻した旨だけを伝え、取り消せるかは言わない', () => {
    const discarded = { kind: 'discarded' } as const
    expect(formatAgentChangesRevertedNotice(2, discarded)).toBe('2 件を実行前の状態に戻しました。')
    expect(formatAgentChangesHunkRevertedNotice(discarded)).toBe(
      'ハンクを実行前の状態に戻しました。'
    )
    expect(formatAgentRevertPartialWarning('途中で失敗', 1, discarded)).toBe('途中で失敗')
  })
  it('対象の文言は operation で決まる(all は 1 件でも「すべて戻す」)', () => {
    expect(formatAgentChangesUndoTarget(makeAgentChangesUndoSummary({ operation: 'file' }))).toBe(
      'a.txt'
    )
    expect(formatAgentChangesUndoTarget(makeAgentChangesUndoSummary({ operation: 'hunk' }))).toBe(
      'a.txt のハンク'
    )
    expect(formatAgentChangesUndoTarget(makeAgentChangesUndoSummary({ operation: 'all' }))).toBe(
      '1 件（すべて戻す）'
    )
    expect(
      formatAgentChangesUndoTarget(
        makeAgentChangesUndoSummary({
          operation: 'all',
          entries: [
            { path: 'a.txt', action: 'rewrite' },
            { path: 'b.txt', action: 'trash' },
            { path: 'c.txt', action: 'recreate' }
          ]
        })
      )
    ).toBe('3 件（すべて戻す）')
    expect(formatAgentChangesUndoBandText('a.txt')).toBe('直前に戻した操作: a.txt')
    expect(formatAgentChangesUndoButtonLabel('a.txt')).toBe('戻した操作を取り消す（直前: a.txt）')
    expect(formatAgentChangesUndoneNotice(3)).toBe('戻した操作を取り消しました（3 件）')
  })
  it('取り消しの確認: パスの一覧と、該当するときだけの追記', () => {
    expect(
      buildAgentUndoConfirmMessage({
        summary: makeAgentChangesUndoSummary(),
        hasUnsavedEdits: false,
        agentRunning: false
      })
    ).toBe('直前に戻した操作を取り消しますか？次のファイルが、戻す前の内容に戻ります。\n\na.txt')
    const entries = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name, index) => ({
      path: `${name}.txt`,
      action:
        index === 0
          ? ('trash' as const)
          : index === 1
            ? ('recreate' as const)
            : ('rewrite' as const)
    }))
    expect(
      buildAgentUndoConfirmMessage({
        summary: makeAgentChangesUndoSummary({ operation: 'all', entries }),
        hasUnsavedEdits: true,
        agentRunning: true
      })
    ).toBe(
      '直前に戻した操作を取り消しますか？次のファイルが、戻す前の内容に戻ります。\n\na.txt\nb.txt\nc.txt\nd.txt\ne.txt\nほか 2 件' +
        '\n\nうち 1 件は、戻したときに作り直したファイルのため、ゴミ箱へ移動します。' +
        '\n\nゴミ箱へ移したファイルは、ゴミ箱に残したまま元の場所に作り直します。' +
        '\n\nエディタの未保存の編集も破棄されます。' +
        '\n\nエージェントが動いている間は、取り消した後に同じファイルが書き換えられることがあります。'
    )
  })
  it('戻す確認の文言は取り消せる旨を出し、フォルダは取り消せない旨を出す', () => {
    const none = { author: null, savedInApp: false, hasUnsavedEdits: false, agentRunning: false }
    expect(
      buildAgentRevertFileConfirmMessage({
        path: 'a.txt',
        status: 'M',
        isDirectory: false,
        ...none
      })
    ).toBe(
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
    )
    expect(
      buildAgentRevertFileConfirmMessage({
        path: 'z.txt',
        status: 'A',
        isDirectory: false,
        ...none
      })
    ).toBe(
      'z.txt をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
    )
    expect(
      buildAgentRevertFileConfirmMessage({ path: 'nd/', status: 'A', isDirectory: true, ...none })
    ).toBe(
      'nd/ をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。'
    )
    expect(
      buildAgentRevertHunkConfirmMessage({ path: 'a.txt', hunkHeader: '@@ -1 +1 @@', ...none })
    ).toBe(
      'a.txt の次のハンクを実行前の状態に戻しますか？戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。\n\n@@ -1 +1 @@'
    )
    const all = {
      count: 2,
      trashCount: 1,
      savedInApp: false,
      agentRunning: false,
      attribution: makeAgentChangesTrackingSummary(),
      startedAt: at(10, 0),
      excludedCount: 0
    }
    expect(buildAgentRevertAllConfirmMessage({ ...all, hasDirectory: false })).toBe(
      'エージェントの変更 2 件を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。\nうち 1 件の新しいファイル・フォルダはゴミ箱へ移動します。\nステージ（index）・コミット・ブランチは戻しません。'
    )
    expect(buildAgentRevertAllConfirmMessage({ ...all, hasDirectory: true })).toContain(
      '戻ります。フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。\nうち 1 件'
    )
  })
})

describe('利用者の変更との区別の文言', () => {
  const startedAt = at(10, 0)
  // すべて戻すの確認の、順 1〜5 の部分の前後(取り消せる旨とステージの行)
  const allConfirm = (note: string): string =>
    `エージェントの変更 2 件を実行前の状態に戻しますか？${note}戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。\nステージ（index）・コミット・ブランチは戻しません。`
  const buildAll = (
    attribution: Parameters<typeof buildAgentRevertAllConfirmMessage>[0]['attribution'],
    excludedCount = 0
  ): string =>
    buildAgentRevertAllConfirmMessage({
      count: 2,
      trashCount: 0,
      hasDirectory: false,
      savedInApp: false,
      agentRunning: false,
      attribution,
      startedAt,
      excludedCount
    })

  it.each([
    ['user', '利用者の変更'],
    ['mixed', '利用者の変更を含む'],
    ['agent', null],
    [null, null]
  ] as const)('行の author が %s なら印は %s', (author, expected) => {
    expect(agentChangeAuthorMark(author)).toBe(expected)
  })

  it('行の印の文言は、利用者の変更と利用者の変更を含むの 2 つ', () => {
    expect(AGENT_CHANGES_USER_MARK).toBe('利用者の変更')
    expect(AGENT_CHANGES_MIXED_MARK).toBe('利用者の変更を含む')
  })

  it('除く旨は、すべて戻すから除く件数を入れて言う', () => {
    expect(formatAgentChangesExcludedNote(3)).toBe(
      'すべて戻すは、利用者の変更（3 件）を除いて戻します'
    )
  })

  it('対象 0 件の押せない理由は、ファイルごとに戻すよう促す', () => {
    expect(AGENT_CHANGES_ONLY_USER_REASON).toBe(
      '利用者の変更だけのため、すべて戻すの対象がありません。ファイルごとに戻してください'
    )
  })

  it('区別をやめた理由の文言は 4 つの理由を網羅する', () => {
    expect(AGENT_CHANGES_ATTRIBUTION_LOST_REASONS).toEqual({
      'hooks-not-confirmed': 'claude の hooks から知らせが届きません',
      'receiver-unavailable': 'hooks の知らせの受け口を用意できませんでした',
      'claude-version-unsupported': 'claude の版が古いか、版を確かめられませんでした',
      'checkpoint-failed': '作業ツリーの記録に失敗しました'
    })
  })

  it('区別しているか: tracking は区別を始めた後、lost は印が残っているとき', () => {
    expect(isAgentChangesAttributionDistinguishing(makeAgentChangesTrackingSummary())).toBe(false)
    expect(
      isAgentChangesAttributionDistinguishing(makeAgentChangesTrackingSummary({ since: startedAt }))
    ).toBe(true)
    expect(isAgentChangesAttributionDistinguishing(makeAgentChangesLostSummary())).toBe(false)
    expect(
      isAgentChangesAttributionDistinguishing(makeAgentChangesLostSummary({ hadMarks: true }))
    ).toBe(true)
  })

  it.each<[string, Parameters<typeof describeAgentChangesAttribution>[0], string | null]>([
    [
      'lost・印なし',
      makeAgentChangesLostSummary({ reason: 'hooks-not-confirmed' }),
      '利用者の変更を区別できません（claude の hooks から知らせが届きません）。すべてエージェントの変更として表示します'
    ],
    [
      'lost・印あり',
      makeAgentChangesLostSummary({
        reason: 'checkpoint-failed',
        lostAt: at(11, 30),
        hadMarks: true
      }),
      '11:30 から利用者の変更を区別できなくなりました（作業ツリーの記録に失敗しました）。それ以降の変更には印を付けません'
    ],
    [
      'lost・印あり・やめた時点で開いていた区間など印を付けていない間があった',
      makeAgentChangesLostSummary({
        reason: 'hooks-not-confirmed',
        lostAt: at(11, 30),
        hadMarks: true,
        since: startedAt,
        hadUnassignedSince: true
      }),
      '11:30 から利用者の変更を区別できなくなりました（claude の hooks から知らせが届きません）。それ以降の変更には印を付けません。アプリの中で claude が動いていなかった間などの変更には、印を付けていません'
    ],
    ['tracking・区別をまだ始めていない', makeAgentChangesTrackingSummary(), null],
    [
      'tracking・区別を始めたのが記録の開始より後',
      makeAgentChangesTrackingSummary({ since: at(10, 5) }),
      '利用者の変更の区別は 10:05 からです（それより前の変更には印を付けません）'
    ],
    [
      'tracking・印を付けていない間があった',
      makeAgentChangesTrackingSummary({ since: startedAt, hadUnassignedSince: true }),
      'アプリの中で claude が動いていなかった間などの変更には、印を付けていません'
    ],
    [
      'tracking・上の 2 つが両方',
      makeAgentChangesTrackingSummary({ since: at(10, 5), hadUnassignedSince: true }),
      '利用者の変更の区別は 10:05 からです（それより前の変更には印を付けません）。アプリの中で claude が動いていなかった間などの変更には、印を付けていません'
    ],
    [
      'tracking・記録の開始から区別していて、印を付けていない間も無い',
      makeAgentChangesTrackingSummary({ since: startedAt }),
      null
    ]
  ])('区別の状態の 1 行: %s', (_label, attribution, expected) => {
    expect(describeAgentChangesAttribution(attribution, startedAt)).toBe(expected)
  })

  it.each<[string, Parameters<typeof buildAll>[0], number, string]>([
    [
      '区別していない(tracking・区別をまだ始めていない)',
      makeAgentChangesTrackingSummary(),
      0,
      '記録を始めた後にあなたが編集した内容も戻ります。'
    ],
    [
      '区別していない(lost・印なし)',
      makeAgentChangesLostSummary({ lostAt: at(11, 30) }),
      0,
      '記録を始めた後にあなたが編集した内容も戻ります。'
    ],
    [
      '区別していない要約で除く行がある(一覧が古いまま記録だけが lost になった。順 1 は今のまま、順 5 は出す)',
      makeAgentChangesTrackingSummary(),
      1,
      '記録を始めた後にあなたが編集した内容も戻ります。利用者の変更 1 件（印の付いた行）は戻しません。行の ↶ で個別に戻せます。'
    ],
    [
      '区別している(記録の開始から・印を付けていない間なし)',
      makeAgentChangesTrackingSummary({ since: startedAt }),
      0,
      AGENT_REVERT_ALL_DISTINGUISHING_NOTE
    ],
    [
      '区別している・区別を始めたのが記録の開始より後',
      makeAgentChangesTrackingSummary({ since: at(10, 5) }),
      0,
      `${AGENT_REVERT_ALL_DISTINGUISHING_NOTE}10:05 より前のあなたの編集も戻ります。`
    ],
    [
      '区別している・印を付けていない間があった',
      makeAgentChangesTrackingSummary({ since: startedAt, hadUnassignedSince: true }),
      0,
      `${AGENT_REVERT_ALL_DISTINGUISHING_NOTE}アプリの中で claude が動いていなかった間などのあなたの編集も戻ります。`
    ],
    [
      '区別している・lost で印がある・除く行がある',
      makeAgentChangesLostSummary({ since: startedAt, lostAt: at(11, 30), hadMarks: true }),
      2,
      `${AGENT_REVERT_ALL_DISTINGUISHING_NOTE}区別をやめた後（11:30 から）のあなたの編集も戻ります。利用者の変更 2 件（印の付いた行）は戻しません。行の ↶ で個別に戻せます。`
    ],
    [
      '区別していた記録が lost(開いていた区間を割り当てない区間として hadUnassignedSince が真。順 3 と順 4 の両方が出る)',
      makeAgentChangesLostSummary({
        since: startedAt,
        hadUnassignedSince: true,
        lostAt: at(11, 30),
        hadMarks: true
      }),
      0,
      `${AGENT_REVERT_ALL_DISTINGUISHING_NOTE}アプリの中で claude が動いていなかった間などのあなたの編集も戻ります。区別をやめた後（11:30 から）のあなたの編集も戻ります。`
    ],
    [
      '順 1〜5 がすべて出る',
      makeAgentChangesLostSummary({
        since: at(10, 5),
        hadUnassignedSince: true,
        lostAt: at(11, 30),
        hadMarks: true
      }),
      1,
      `${AGENT_REVERT_ALL_DISTINGUISHING_NOTE}10:05 より前のあなたの編集も戻ります。アプリの中で claude が動いていなかった間などのあなたの編集も戻ります。区別をやめた後（11:30 から）のあなたの編集も戻ります。利用者の変更 1 件（印の付いた行）は戻しません。行の ↶ で個別に戻せます。`
    ]
  ])('すべて戻すの確認: %s', (_label, attribution, excludedCount, note) => {
    expect(buildAll(attribution, excludedCount)).toBe(allConfirm(note))
  })

  it('区別しているときの順 1 の文は、エージェントの変更になる利用者の編集をすべて言う', () => {
    expect(AGENT_REVERT_ALL_DISTINGUISHING_NOTE).toBe(
      'エージェントのツールが動いている間（終わってから 2 秒・許可の確認を待つ間を含む）と、claude を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。'
    )
  })

  it.each(['user', 'mixed'] as const)(
    '行の ↶ の確認は、author が %s なら今の文言の後(アプリで保存した旨などの前)に利用者の変更の旨を足す(user も言い切らず同じ文。L-006)',
    (author) => {
      expect(
        buildAgentRevertFileConfirmMessage({
          path: 'a.txt',
          status: 'M',
          isDirectory: false,
          author,
          savedInApp: true,
          hasUnsavedEdits: false,
          agentRunning: false
        }).split('\n\n')
      ).toEqual([
        'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。',
        'このファイル（フォルダ）には、エージェントのツールが動いていない間の変更（利用者の変更）が含まれます。',
        'このファイルは、記録を始めた後にアプリで保存されています。'
      ])
    }
  )

  it.each(['agent', null] as const)('行の ↶ の確認は、author が %s なら何も足さない', (author) => {
    expect(
      buildAgentRevertFileConfirmMessage({
        path: 'a.txt',
        status: 'M',
        isDirectory: false,
        author,
        savedInApp: false,
        hasUnsavedEdits: false,
        agentRunning: false
      })
    ).toBe(
      'a.txt を実行前の状態に戻しますか？記録を始めた後にあなたが編集した内容も戻ります。実行の前からあった変更は残ります。戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
    )
  })
})
