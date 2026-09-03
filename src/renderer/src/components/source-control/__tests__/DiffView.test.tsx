import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import DiffView from '../DiffView'

const SAMPLE_DIFF = [
  'diff --git a/src/index.ts b/src/index.ts',
  'index abc123..def456 100644',
  '--- a/src/index.ts',
  '+++ b/src/index.ts',
  '@@ -1,2 +1,2 @@',
  ' line1',
  '-line2',
  '+line2modified',
  '@@ -10,1 +10,2 @@',
  ' line10',
  '+line11new',
  '',
].join('\n')

describe('DiffView', () => {
  it('各ハンクを表示し、変更行を +/- で表示する', () => {
    render(
      <DiffView diffText={SAMPLE_DIFF} staged={false} onStageHunk={vi.fn()} onUnstageHunk={vi.fn()} />
    )
    expect(screen.getByText('-line2')).toBeInTheDocument()
    expect(screen.getByText('+line2modified')).toBeInTheDocument()
    expect(screen.getByText('+line11new')).toBeInTheDocument()
  })

  it('staged=false のとき各ハンクにステージボタンを表示する', () => {
    render(
      <DiffView diffText={SAMPLE_DIFF} staged={false} onStageHunk={vi.fn()} onUnstageHunk={vi.fn()} />
    )
    expect(screen.getAllByRole('button', { name: 'このハンクをステージ' })).toHaveLength(2)
  })

  it('staged=true のとき各ハンクにアンステージボタンを表示する', () => {
    render(
      <DiffView diffText={SAMPLE_DIFF} staged={true} onStageHunk={vi.fn()} onUnstageHunk={vi.fn()} />
    )
    expect(screen.getAllByRole('button', { name: 'このハンクをアンステージ' })).toHaveLength(2)
  })

  it('ステージボタンをクリックすると onStageHunk がそのハンクのパッチで呼ばれる', async () => {
    const onStageHunk = vi.fn()
    render(
      <DiffView diffText={SAMPLE_DIFF} staged={false} onStageHunk={onStageHunk} onUnstageHunk={vi.fn()} />
    )
    const buttons = screen.getAllByRole('button', { name: 'このハンクをステージ' })
    await userEvent.click(buttons[0])
    expect(onStageHunk).toHaveBeenCalledTimes(1)
    const patch = onStageHunk.mock.calls[0][0] as string
    expect(patch).toContain('@@ -1,2 +1,2 @@')
    expect(patch).not.toContain('@@ -10,1 +10,2 @@')
  })

  it('アンステージボタンをクリックすると onUnstageHunk がそのハンクのパッチで呼ばれる', async () => {
    const onUnstageHunk = vi.fn()
    render(
      <DiffView diffText={SAMPLE_DIFF} staged={true} onStageHunk={vi.fn()} onUnstageHunk={onUnstageHunk} />
    )
    const buttons = screen.getAllByRole('button', { name: 'このハンクをアンステージ' })
    await userEvent.click(buttons[1])
    const patch = onUnstageHunk.mock.calls[0][0] as string
    expect(patch).toContain('@@ -10,1 +10,2 @@')
  })

  it('diffText が空文字列の場合、ハンクもボタンも表示しない', () => {
    render(<DiffView diffText="" staged={false} onStageHunk={vi.fn()} onUnstageHunk={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'このハンクをステージ' })).not.toBeInTheDocument()
  })
})
