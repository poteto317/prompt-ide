import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AgentInstructionSubfolderList from '../AgentInstructionSubfolderList'
import type { AgentInstructionSubfolderRow } from '../../../types'

const row = (relativePath: string, description = '共有の指示'): AgentInstructionSubfolderRow => ({
  relativePath,
  description,
  node: { name: relativePath.split('/').pop() ?? '', path: `/p/${relativePath}`, type: 'file' }
})

type Props = React.ComponentProps<typeof AgentInstructionSubfolderList>
const renderList = (
  overrides: Partial<Props> = {}
): ReturnType<typeof render> & { props: Props } => {
  const props: Props = {
    rows: [row('src/CLAUDE.md'), row('src/CLAUDE.local.md', '個人の指示')],
    total: 2,
    note: null,
    isBlocked: false,
    isCreating: false,
    onOpen: vi.fn(),
    ...overrides
  }
  return { ...render(<AgentInstructionSubfolderList {...props} />), props }
}

const toggle = (): HTMLElement => screen.getByRole('button', { name: /^サブフォルダ\(/ })

describe('AgentInstructionSubfolderList', () => {
  it('既定 → 折りたたみ。件数入りの開閉のボタンだけを出す', () => {
    renderList()
    expect(toggle()).toHaveAccessibleName('サブフォルダ(2 件)')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).not.toHaveAttribute('aria-controls')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('押す → 開き、aria-controls が注・一覧などを包む div を指す。もう一度押すと閉じる', async () => {
    renderList()
    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    const region = document.getElementById(toggle().getAttribute('aria-controls') ?? '')
    expect(region).not.toBeNull()
    expect(region).toContainElement(screen.getByRole('list'))
    expect(screen.getByRole('button', { name: 'src/CLAUDE.md を開く' })).toHaveTextContent('開く')
    expect(screen.getByText('個人の指示')).toBeInTheDocument()
    // 上限以下(隠した分が 0 件)では「ほか」を出さない
    expect(screen.queryByText(/^ほか /)).toBeNull()
    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('開いた領域は高さの上限とスクロールを持つ class を付ける(CSS は jsdom で測れないため class で固定)', async () => {
    renderList()
    await userEvent.click(toggle())
    const region = document.getElementById(toggle().getAttribute('aria-controls') ?? '')
    expect(region).toHaveClass('agent-instructions__subfolder-region')
  })

  it('0 件で開く → 文言を出し、aria-controls の先がある', async () => {
    renderList({ rows: [], total: 0 })
    expect(toggle()).toHaveAccessibleName('サブフォルダ(0 件)')
    await userEvent.click(toggle())
    expect(screen.getByText('サブフォルダに指示ファイルはありません')).toBeInTheDocument()
    expect(document.getElementById(toggle().getAttribute('aria-controls') ?? '')).not.toBeNull()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('上限を超える → 件数は全件、最後に「ほか N 件」', async () => {
    renderList({ rows: [row('a/CLAUDE.md')], total: 12 })
    expect(toggle()).toHaveAccessibleName('サブフォルダ(12 件)')
    await userEvent.click(toggle())
    expect(screen.getByText('ほか 11 件(ファイルツリーから開いてください)')).toBeInTheDocument()
  })

  it('注 → 一覧の前に出し、一覧の aria-describedby が注を指す。role=alert にしない', async () => {
    const note =
      'GitHub Copilot CLI は、サブフォルダの AGENTS.md を読まないことがあります(このアプリはフォルダの根で CLI を起動するため)'
    renderList({ rows: [row('src/AGENTS.md')], total: 1, note })
    await userEvent.click(toggle())
    expect(screen.getByRole('list')).toHaveAccessibleDescription(note)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('開く → その行で onOpen を呼ぶ', async () => {
    const { props } = renderList()
    await userEvent.click(toggle())
    await userEvent.click(screen.getByRole('button', { name: 'src/CLAUDE.local.md を開く' }))
    expect(props.onOpen).toHaveBeenCalledWith(props.rows[1])
  })

  it('clone 中 → 開くは disabled、開閉のボタンは押せる', async () => {
    renderList({ isBlocked: true })
    expect(toggle()).not.toBeDisabled()
    await userEvent.click(toggle())
    expect(screen.getByRole('button', { name: 'src/CLAUDE.md を開く' })).toBeDisabled()
  })

  it('作成の途中 → 開くは aria-disabled で押しても呼ばない。開閉のボタンは押せる', async () => {
    const { props } = renderList({ isCreating: true })
    expect(toggle()).not.toHaveAttribute('aria-disabled')
    await userEvent.click(toggle())
    const open = screen.getByRole('button', { name: 'src/CLAUDE.md を開く' })
    expect(open).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(open)
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(open)
  })

  it('開いた状態で 0 件になる → 開閉のボタンは残り、フォーカスを持ったまま開いている。注が変わっても閉じない', async () => {
    const { rerender, props } = renderList()
    await userEvent.click(toggle())
    const button = toggle()
    expect(document.activeElement).toBe(button)
    rerender(<AgentInstructionSubfolderList {...props} rows={[]} total={0} />)
    expect(toggle()).toBe(button)
    expect(document.activeElement).toBe(button)
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('サブフォルダに指示ファイルはありません')).toBeInTheDocument()
    // CLI を切り替えたときに当たる(注が変わっても開閉の状態は戻さない)
    rerender(
      <AgentInstructionSubfolderList
        {...props}
        rows={[]}
        total={0}
        note="GitHub Copilot CLI は、サブフォルダの AGENTS.md を読まないことがあります"
      />
    )
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(document.activeElement).toBe(button)
  })
})
