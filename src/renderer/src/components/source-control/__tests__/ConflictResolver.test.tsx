import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ConflictFile } from '@shared/types'
import ConflictResolver from '../ConflictResolver'
import { makeConflictFileState } from '../../../__tests__/makeConflictFileState'

const both = { ours: true, theirs: true }

const twoBlocks: ConflictFile = {
  status: 'parsed',
  stages: both,
  eol: '\n',
  digests: ['d0', 'd1'],
  segments: [
    { kind: 'text', lines: ['前の行'] },
    {
      kind: 'conflict',
      ours: ['同じ行', '自分A'],
      theirs: ['同じ行', '相手A'],
      oursLabel: 'HEAD',
      theirsLabel: 'feature'
    },
    { kind: 'text', lines: ['間の行'] },
    {
      kind: 'conflict',
      ours: ['同じ行', '自分B'],
      theirs: ['同じ行', '相手B'],
      oursLabel: 'HEAD',
      theirsLabel: 'feature'
    }
  ]
}

const noBlocks: ConflictFile = {
  status: 'parsed',
  stages: both,
  eol: '\n',
  digests: [],
  segments: [{ kind: 'text', lines: ['残った内容'] }]
}

describe('ConflictResolver', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('読み込み中で内容が無いときは「読み込み中...」を出す', () => {
    render(
      <ConflictResolver isBlocked={false} conflict={makeConflictFileState({ isLoading: true })} />
    )
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('parsed ではテキストとブロックの並びを出す', () => {
    render(
      <ConflictResolver isBlocked={false} conflict={makeConflictFileState({ file: twoBlocks })} />
    )
    expect(screen.getByText('前の行')).toBeInTheDocument()
    expect(screen.getByText('間の行')).toBeInTheDocument()
    expect(screen.getByText('ブロック 1')).toBeInTheDocument()
    expect(screen.getByText('ブロック 2')).toBeInTheDocument()
    expect(screen.getByText('自分A')).toBeInTheDocument()
    expect(screen.getByText('相手B')).toBeInTheDocument()
  })

  it('ブロックの並びで React の key の重複警告が出ない(同じ内容のブロック・行があっても)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sameBlock = {
      kind: 'conflict' as const,
      ours: ['同じ行', '同じ行'],
      theirs: ['同じ行'],
      oursLabel: 'HEAD',
      theirsLabel: 'feature'
    }
    const file: ConflictFile = {
      status: 'parsed',
      stages: both,
      eol: '\n',
      digests: ['d', 'd'],
      segments: [
        { kind: 'text', lines: ['同じ行'] },
        sameBlock,
        { kind: 'text', lines: ['同じ行'] },
        sameBlock
      ]
    }
    render(<ConflictResolver isBlocked={false} conflict={makeConflictFileState({ file })} />)
    const keyWarnings = errorSpy.mock.calls.filter((args) => String(args[0]).includes('key'))
    expect(keyWarnings).toEqual([])
  })

  it('ブロックのボタンで chooseBlock にブロック番号(0 始まり)と選択が渡る', async () => {
    const conflict = makeConflictFileState({ file: twoBlocks })
    render(<ConflictResolver isBlocked={false} conflict={conflict} />)
    await userEvent.click(screen.getByRole('button', { name: 'ブロック 2 を相手の内容にする' }))
    expect(conflict.chooseBlock).toHaveBeenCalledWith(1, 'theirs')
  })

  it('ブロックが残る間は「解決済みにする」が disabled', () => {
    render(
      <ConflictResolver isBlocked={false} conflict={makeConflictFileState({ file: twoBlocks })} />
    )
    expect(screen.getByRole('button', { name: '解決済みにする' })).toBeDisabled()
  })

  it('ブロックが 0 件になると「解決済みにする」が押せ、クリックで markResolved が呼ばれる', async () => {
    const conflict = makeConflictFileState({ file: noBlocks })
    render(<ConflictResolver isBlocked={false} conflict={conflict} />)
    const button = screen.getByRole('button', { name: '解決済みにする' })
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(conflict.markResolved).toHaveBeenCalledTimes(1)
  })

  it('ブロックがあるときのファイル単位の「自分をすべて採用」「相手をすべて採用」', async () => {
    const conflict = makeConflictFileState({ file: twoBlocks })
    render(<ConflictResolver isBlocked={false} conflict={conflict} />)
    await userEvent.click(screen.getByRole('button', { name: '自分をすべて採用' }))
    await userEvent.click(screen.getByRole('button', { name: '相手をすべて採用' }))
    expect(conflict.resolveWholeFile).toHaveBeenNthCalledWith(1, 'ours')
    expect(conflict.resolveWholeFile).toHaveBeenNthCalledWith(2, 'theirs')
  })

  it('ブロックがあるときは「ファイルを残す」「削除する」を出さない', () => {
    render(
      <ConflictResolver isBlocked={false} conflict={makeConflictFileState({ file: twoBlocks })} />
    )
    expect(screen.queryByRole('button', { name: 'ファイルを残す' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '削除する' })).not.toBeInTheDocument()
  })

  it('ブロックが無い追加/削除型(片側のみ)は「ファイルを残す」「削除する」を出し、クリックで呼ばれる', async () => {
    const conflict = makeConflictFileState({
      file: { ...noBlocks, stages: { ours: false, theirs: true } } as ConflictFile
    })
    render(<ConflictResolver isBlocked={false} conflict={conflict} />)
    await userEvent.click(screen.getByRole('button', { name: 'ファイルを残す' }))
    await userEvent.click(screen.getByRole('button', { name: '削除する' }))
    expect(conflict.keepFile).toHaveBeenCalledTimes(1)
    expect(conflict.removeFile).toHaveBeenCalledTimes(1)
  })

  const unparsable = (
    reason: 'binary' | 'markers' | 'not-regular' | 'missing' | 'submodule',
    stages = both
  ): ConflictFile => ({ status: 'unparsable', reason, stages })

  const oneSide = { ours: false, theirs: true }
  const noSide = { ours: false, theirs: false }
  const BOTH_ACTION = '「自分をすべて採用」か「相手をすべて採用」を選んでください'
  const ONE_ACTION = '「ファイルを残す」か「削除する」を選んでください'
  // バイナリ・リンクは「すべて採用」(checkout)だけでは未解決のまま残るため、続けて「解決済みにする」を案内する
  const BOTH_THEN_RESOLVE =
    '「自分をすべて採用」か「相手をすべて採用」を選んでから、「解決済みにする」を押してください'

  it.each([
    ['markers', both, 'コンフリクトのマーカーを解析できません。エディタで直接編集してください'],
    ['binary', both, `バイナリのコンフリクトです。${BOTH_THEN_RESOLVE}`],
    ['binary', oneSide, `バイナリのコンフリクトです。${ONE_ACTION}`],
    ['not-regular', both, `通常のファイルではないため、ブロックを選べません。${BOTH_THEN_RESOLVE}`],
    ['missing', both, `ファイルが作業ツリーにありません。${BOTH_ACTION}`],
    ['missing', oneSide, `ファイルが作業ツリーにありません。${ONE_ACTION}`],
    ['missing', noSide, 'ファイルが作業ツリーにありません。「削除する」を選んでください'],
    [
      'markers',
      oneSide,
      `コンフリクトのマーカーを解析できません。エディタで直接編集するか、${ONE_ACTION}`
    ]
  ] as const)(
    'unparsable(reason: %s × stages %j)は、出るボタンに合った案内を出す',
    (reason, stages, message) => {
      render(
        <ConflictResolver
          isBlocked={false}
          conflict={makeConflictFileState({ file: unparsable(reason, stages) })}
        />
      )
      expect(screen.getByText(message)).toBeInTheDocument()
      expect(screen.queryByText(/^ブロック \d+$/)).not.toBeInTheDocument()
    }
  )

  const SUBMODULE_NOTICE =
    'サブモジュールのコンフリクトです。サブモジュールの中で採用するコミットを選んでから、ターミナルで git add して解決してください'

  it.each([
    ['両側', both, SUBMODULE_NOTICE],
    ['片側(DU)', oneSide, `${SUBMODULE_NOTICE}（削除する場合は git rm）`],
    ['片側(UD)', { ours: true, theirs: false }, `${SUBMODULE_NOTICE}（削除する場合は git rm）`],
    ['両側無し', noSide, SUBMODULE_NOTICE]
  ])(
    'unparsable(submodule)・%s: 解決のボタンを出さず、ターミナルで解決する案内を出す',
    (_n, stages, notice) => {
      render(
        <ConflictResolver
          isBlocked={false}
          conflict={makeConflictFileState({ file: unparsable('submodule', stages) })}
        />
      )
      expect(screen.getByText(notice)).toHaveClass('conflict-resolver__notice')
      expect(screen.queryAllByRole('button')).toEqual([])
    }
  )

  it('両側が無い(DD)ときは「削除する」だけを出し、「ファイルを残す」「すべて採用」は出さない', () => {
    render(
      <ConflictResolver
        isBlocked={false}
        conflict={makeConflictFileState({ file: unparsable('missing', noSide) })}
      />
    )
    expect(screen.getByRole('button', { name: '削除する' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ファイルを残す' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '自分をすべて採用' })).not.toBeInTheDocument()
  })

  it('unparsable でも両側があれば「自分をすべて採用」「相手をすべて採用」を出し、クリックで呼ばれる', async () => {
    const conflict = makeConflictFileState({ file: unparsable('binary') })
    render(<ConflictResolver isBlocked={false} conflict={conflict} />)
    await userEvent.click(screen.getByRole('button', { name: '自分をすべて採用' }))
    expect(conflict.resolveWholeFile).toHaveBeenCalledWith('ours')
    expect(screen.getByRole('button', { name: '相手をすべて採用' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '削除する' })).not.toBeInTheDocument()
  })

  it.each(['markers', 'binary', 'not-regular'] as const)(
    'unparsable(%s)はファイルがあるので「解決済みにする」を出し、クリックで markResolved が呼ばれる',
    async (reason) => {
      const conflict = makeConflictFileState({ file: unparsable(reason) })
      render(<ConflictResolver isBlocked={false} conflict={conflict} />)
      const button = screen.getByRole('button', { name: '解決済みにする' })
      expect(button).toBeEnabled()
      await userEvent.click(button)
      expect(conflict.markResolved).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    ['両側', both],
    ['片側', oneSide],
    ['両側無し', noSide]
  ])('unparsable(missing)・%s ではファイルが無いので「解決済みにする」を出さない', (_n, stages) => {
    render(
      <ConflictResolver
        isBlocked={false}
        conflict={makeConflictFileState({ file: unparsable('missing', stages) })}
      />
    )
    expect(screen.queryByRole('button', { name: '解決済みにする' })).not.toBeInTheDocument()
  })

  it.each([
    ['自分だけ(相手が削除)', { ours: true, theirs: false }],
    ['相手だけ(自分が削除)', { ours: false, theirs: true }]
  ])(
    '片側にしかファイルが無い(%s)ときは「ファイルを残す」「削除する」だけを出す',
    async (_n, stages) => {
      const conflict = makeConflictFileState({ file: { ...noBlocks, stages } as ConflictFile })
      render(<ConflictResolver isBlocked={false} conflict={conflict} />)
      expect(screen.queryByRole('button', { name: '自分をすべて採用' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '相手をすべて採用' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'ファイルを残す' }))
      await userEvent.click(screen.getByRole('button', { name: '削除する' }))
      expect(conflict.keepFile).toHaveBeenCalledTimes(1)
      expect(conflict.removeFile).toHaveBeenCalledTimes(1)
    }
  )

  it('unparsable で片側にしかファイルが無いときも「ファイルを残す」「削除する」だけを出す', () => {
    const file = unparsable('missing', oneSide)
    render(<ConflictResolver isBlocked={false} conflict={makeConflictFileState({ file })} />)
    expect(screen.getByText(/ファイルが作業ツリーにありません/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ファイルを残す' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '削除する' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '自分をすべて採用' })).not.toBeInTheDocument()
  })

  it('両側にファイルがある(全ブロックを解決後の UU)ときは「ファイルを残す」「削除する」を出さず、「自分をすべて採用」などを出す', () => {
    render(
      <ConflictResolver isBlocked={false} conflict={makeConflictFileState({ file: noBlocks })} />
    )
    expect(screen.queryByRole('button', { name: 'ファイルを残す' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '削除する' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '自分をすべて採用' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '解決済みにする' })).toBeEnabled()
  })

  it('isBlocked のときはすべてのボタンが disabled になる', () => {
    render(<ConflictResolver isBlocked conflict={makeConflictFileState({ file: twoBlocks })} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(3)
    for (const button of buttons) expect(button).toBeDisabled()
  })

  it('空行も 1 行として描画する(テキストとブロックの両方で行数が一致する)', () => {
    const file: ConflictFile = {
      status: 'parsed',
      stages: both,
      eol: '\n',
      digests: ['d'],
      segments: [
        { kind: 'text', lines: ['a', '', 'b'] },
        { kind: 'conflict', ours: ['x', '', 'y'], theirs: [], oursLabel: 'HEAD', theirsLabel: 'f' }
      ]
    }
    const { container } = render(
      <ConflictResolver isBlocked={false} conflict={makeConflictFileState({ file })} />
    )
    expect(container.querySelectorAll('.conflict-resolver__text .diff-view__line')).toHaveLength(3)
    expect(
      container.querySelector('.conflict-block__side--ours')?.querySelectorAll('.diff-view__line')
    ).toHaveLength(3)
  })

  it('ブロックの選択に成功すると role="status" で結果を読み上げ、フォーカスを次のブロックの先頭のボタンへ移す', async () => {
    const afterFirst: ConflictFile = {
      ...twoBlocks,
      segments: [
        twoBlocks.status === 'parsed' ? twoBlocks.segments[3] : { kind: 'text', lines: [] }
      ]
    } as ConflictFile
    const chooseBlock = vi.fn().mockResolvedValue(true)
    const { rerender } = render(
      <ConflictResolver
        isBlocked={false}
        conflict={makeConflictFileState({ file: twoBlocks, chooseBlock })}
      />
    )
    chooseBlock.mockImplementation(async () => {
      // 書き換え後の読み直しで、1 つ目のブロックが消える
      rerender(
        <ConflictResolver
          isBlocked={false}
          conflict={makeConflictFileState({ file: afterFirst, chooseBlock })}
        />
      )
      return true
    })
    await userEvent.click(screen.getByRole('button', { name: 'ブロック 1 を自分の内容にする' }))
    expect(screen.getByRole('status')).toHaveTextContent('ブロック 1 を自分の内容にしました')
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'ブロック 1 を自分の内容にする' })
    )
  })

  it('最後のブロックを選んだ後は、「すべて採用」ではなく「解決済みにする」へフォーカスを移す', async () => {
    const oneBlock = {
      ...twoBlocks,
      digests: ['d0'],
      segments: twoBlocks.status === 'parsed' ? [twoBlocks.segments[1]] : []
    } as ConflictFile
    const chooseBlock = vi.fn()
    const { rerender } = render(
      <ConflictResolver
        isBlocked={false}
        conflict={makeConflictFileState({ file: oneBlock, chooseBlock })}
      />
    )
    chooseBlock.mockImplementation(async () => {
      rerender(
        <ConflictResolver
          isBlocked={false}
          conflict={makeConflictFileState({ file: noBlocks, chooseBlock })}
        />
      )
      return true
    })
    await userEvent.click(screen.getByRole('button', { name: 'ブロック 1 を相手の内容にする' }))
    expect(screen.getByRole('status')).toHaveTextContent('ブロック 1 を相手の内容にしました')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '解決済みにする' }))
  })

  it('同じ選択(ブロック 1 の自分)を続けても、2 回目も読み上げとフォーカス移動が起こる', async () => {
    const block = (label: string): object => ({
      kind: 'conflict',
      ours: [label],
      theirs: ['t'],
      oursLabel: 'HEAD',
      theirsLabel: 'f'
    })
    const make = (n: number): ConflictFile =>
      ({
        status: 'parsed',
        stages: both,
        eol: '\n',
        digests: Array.from({ length: n }, (_, i) => `d${i}`),
        segments: Array.from({ length: n }, (_, i) => block(`o${i}`))
      }) as ConflictFile
    const chooseBlock = vi.fn()
    const { rerender } = render(
      <ConflictResolver
        isBlocked={false}
        conflict={makeConflictFileState({ file: make(3), chooseBlock })}
      />
    )
    let remaining = 3
    chooseBlock.mockImplementation(async () => {
      remaining -= 1
      rerender(
        <ConflictResolver
          isBlocked={false}
          conflict={makeConflictFileState({ file: make(remaining), chooseBlock })}
        />
      )
      return true
    })
    const status = screen.getByRole('status')
    const first = (): HTMLElement =>
      screen.getByRole('button', { name: 'ブロック 1 を自分の内容にする' })
    await userEvent.click(first())
    const textAfterFirst = status.textContent
    expect(status).toHaveTextContent('ブロック 1 を自分の内容にしました')
    // フォーカスを外し、2 回目で再び移ることを確かめる
    ;(document.activeElement as HTMLElement).blur()
    await userEvent.click(first())
    expect(chooseBlock).toHaveBeenCalledTimes(2)
    expect(status).toHaveTextContent('ブロック 1 を自分の内容にしました')
    expect(status.textContent).not.toBe(textAfterFirst)
    expect(document.activeElement).toBe(first())
  })

  it('選択が適用されなかった(false)ときは読み上げもフォーカス移動もしない', async () => {
    const chooseBlock = vi.fn().mockResolvedValue(false)
    render(
      <ConflictResolver
        isBlocked={false}
        conflict={makeConflictFileState({ file: twoBlocks, chooseBlock })}
      />
    )
    const button = screen.getByRole('button', { name: 'ブロック 1 を両方にする' })
    await userEvent.click(button)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(document.activeElement).toBe(button)
  })

  it('実行中はすべてのボタンが disabled になる', () => {
    render(
      <ConflictResolver
        isBlocked={false}
        conflict={makeConflictFileState({ file: noBlocks, pendingOperation: 'resolve' })}
      />
    )
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('実行中はブロックのボタンも disabled になる', () => {
    render(
      <ConflictResolver
        isBlocked={false}
        conflict={makeConflictFileState({ file: twoBlocks, pendingOperation: 'block' })}
      />
    )
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('error を role="alert" で出す', () => {
    render(
      <ConflictResolver
        isBlocked={false}
        conflict={makeConflictFileState({ error: new Error('中止しました') })}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('中止しました')
  })
})
