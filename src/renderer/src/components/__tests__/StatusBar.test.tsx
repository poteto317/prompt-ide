import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import StatusBar from '../StatusBar'
import type { AgentStatusBarState } from '../../hooks/useAgentStatusBar'

const makeAgent = (overrides: Partial<AgentStatusBarState> = {}): AgentStatusBarState => ({
  items: [
    { activity: 'permission', count: 1 },
    { activity: 'working', count: 2 }
  ],
  needsAttention: true,
  onActivate: vi.fn(),
  ...overrides
})

describe('StatusBar', () => {
  it('ブランチ名 "main" が表示される', () => {
    render(<StatusBar agent={null} />)
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('"TypeScript" が表示される', () => {
    render(<StatusBar agent={null} />)
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
  })

  it('"Ln 1, Col 1" が表示される', () => {
    render(<StatusBar agent={null} />)
    expect(screen.getByText('Ln 1, Col 1')).toBeInTheDocument()
  })

  it('"UTF-8" が表示される', () => {
    render(<StatusBar agent={null} />)
    expect(screen.getByText('UTF-8')).toBeInTheDocument()
  })

  it('エージェントのまとめが無ければ、ボタンなどのインタラクティブ要素が存在しない（表示専用）', () => {
    render(<StatusBar agent={null} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  describe('エージェントのまとめ', () => {
    // ボタンが出ないことは上の「表示専用」のテストで確かめる
    it('agent が null ならまとめの文言を出さない', () => {
      render(<StatusBar agent={null} />)
      expect(screen.queryByText(/エージェント/)).not.toBeInTheDocument()
    })

    it('items が空なら何も出さない', () => {
      render(<StatusBar agent={makeAgent({ items: [], needsAttention: false })} />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(screen.queryByText(/エージェント/)).not.toBeInTheDocument()
    })

    it('まとめの文言と aria-label を持つボタンを出す', () => {
      render(<StatusBar agent={makeAgent()} />)
      const button = screen.getByRole('button', {
        name: 'エージェント: 許可待ち 1 · 作業中 2（押すとターミナルを開きます）'
      })
      expect(button).toHaveTextContent('エージェント: 許可待ち 1 · 作業中 2')
      expect(button).toHaveAttribute('type', 'button')
    })

    it('ブランチの表示の後ろ(左側)に置く', () => {
      const { container } = render(<StatusBar agent={makeAgent()} />)
      const children = Array.from(container.querySelector('.status-bar')!.children)
      const branchIndex = children.findIndex((el) => el.textContent === 'main')
      const agentIndex = children.findIndex((el) => el.matches('.status-bar__agent'))
      const spacerIndex = children.findIndex((el) => el.matches('.status-bar__spacer'))
      expect(agentIndex).toBe(branchIndex + 1)
      expect(agentIndex).toBeLessThan(spacerIndex)
    })

    it('操作が必要なら強調の class を付け、そうでなければ付けない', () => {
      const { rerender } = render(<StatusBar agent={makeAgent()} />)
      expect(screen.getByRole('button')).toHaveClass('status-bar__agent--attention')
      rerender(
        <StatusBar
          agent={makeAgent({ items: [{ activity: 'working', count: 1 }], needsAttention: false })}
        />
      )
      expect(screen.getByRole('button')).not.toHaveClass('status-bar__agent--attention')
    })

    it('押すと onActivate を呼ぶ', async () => {
      const agent = makeAgent()
      render(<StatusBar agent={agent} />)
      await userEvent.click(screen.getByRole('button'))
      expect(agent.onActivate).toHaveBeenCalledTimes(1)
    })
  })
})

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する(AgentTerminalPanel.styles.test.tsx と同じ流儀)
describe('ステータスバーのスタイル(main.css)', () => {
  let styleElement: HTMLStyleElement

  beforeAll(() => {
    styleElement = document.createElement('style')
    styleElement.textContent = readFileSync(resolve(__dirname, '../../assets/main.css'), 'utf-8')
    document.head.appendChild(styleElement)
  })

  afterAll(() => {
    styleElement.remove()
  })

  it('エージェントのまとめはタッチで押せる 32px 以上の高さ', () => {
    render(<StatusBar agent={makeAgent()} />)
    const button = getComputedStyle(screen.getByRole('button'))
    expect(button.minHeight).toBe('32px')
    expect(button.boxSizing).toBe('border-box')
  })

  it('ステータスバーは 32px のボタンが入るよう、高さを固定しない', () => {
    const { container } = render(<StatusBar agent={makeAgent()} />)
    const bar = getComputedStyle(container.querySelector('.status-bar') as HTMLElement)
    expect(bar.height).toBe('auto')
    expect(bar.minHeight).toBe('22px')
  })
})
