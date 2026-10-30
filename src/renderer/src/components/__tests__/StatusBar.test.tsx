import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import StatusBar from '../StatusBar'
import type { StatusBarBranchState } from '../StatusBarBranch'
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

const makeBranch = (overrides: Partial<StatusBarBranchState> = {}): StatusBarBranchState => ({
  currentBranch: 'main',
  branches: [{ name: 'main', current: true }],
  pendingBranchOperation: null,
  isBlocked: false,
  error: null,
  remoteError: null,
  ahead: 0,
  behind: 0,
  isSyncing: false,
  isSyncBlocked: false,
  onCheckoutBranch: vi.fn().mockResolvedValue(undefined),
  onSync: vi.fn().mockResolvedValue(undefined),
  onCreateBranch: vi.fn().mockResolvedValue(true),
  onDeleteBranch: vi.fn().mockResolvedValue(true),
  onMergeBranch: vi.fn().mockResolvedValue(undefined),
  ...overrides
})

describe('StatusBar', () => {
  describe('ブランチの表示', () => {
    it('branch があれば、現在のブランチ名を押せるボタンで出す', () => {
      render(<StatusBar agent={null} branch={makeBranch({ currentBranch: 'develop' })} />)
      expect(screen.getByRole('button', { name: 'ブランチを切り替え' })).toHaveTextContent(
        'develop'
      )
    })

    it('branch が null(リポジトリの外)なら何も出さない', () => {
      render(<StatusBar agent={null} branch={null} />)
      expect(screen.queryByText('main')).not.toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('失敗の表示は、ブランチの右、エージェントのまとめの左に置く', () => {
      const { container } = render(
        <StatusBar agent={makeAgent()} branch={makeBranch({ error: new Error('失敗') })} />
      )
      const children = Array.from(container.querySelector('.status-bar')!.children)
      const branchIndex = children.findIndex((el) => el.matches('.status-bar__branch'))
      const errorIndex = children.indexOf(screen.getByRole('alert'))
      const agentIndex = children.findIndex((el) => el.matches('.status-bar__agent'))
      expect(errorIndex).toBe(branchIndex + 1)
      expect(agentIndex).toBe(errorIndex + 1)
    })

    it('同期のボタンと失敗の表示は、ブランチの右、エージェントのまとめの左に順に並ぶ', () => {
      const { container } = render(
        <StatusBar
          agent={makeAgent()}
          branch={makeBranch({
            ahead: 1,
            error: new Error('切り替えの失敗'),
            remoteError: new Error('同期の失敗')
          })}
        />
      )
      const children = Array.from(container.querySelector('.status-bar')!.children)
      const branchIndex = children.findIndex((el) => el.matches('.status-bar__branch'))
      expect(children.slice(branchIndex + 1, branchIndex + 5)).toEqual([
        screen.getByRole('button', { name: /^変更を同期/ }),
        screen.getByText('切り替えの失敗'),
        screen.getByText('同期の失敗'),
        container.querySelector('.status-bar__agent')
      ])
    })
  })

  it('"TypeScript" が表示される', () => {
    render(<StatusBar agent={null} branch={null} />)
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
  })

  it('"Ln 1, Col 1" が表示される', () => {
    render(<StatusBar agent={null} branch={null} />)
    expect(screen.getByText('Ln 1, Col 1')).toBeInTheDocument()
  })

  it('"UTF-8" が表示される', () => {
    render(<StatusBar agent={null} branch={null} />)
    expect(screen.getByText('UTF-8')).toBeInTheDocument()
  })

  it('エージェントのまとめが無ければ、ボタンなどのインタラクティブ要素が存在しない（表示専用）', () => {
    render(<StatusBar agent={null} branch={null} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  describe('エージェントのまとめ', () => {
    // ボタンが出ないことは上の「表示専用」のテストで確かめる
    it('agent が null ならまとめの文言を出さない', () => {
      render(<StatusBar agent={null} branch={null} />)
      expect(screen.queryByText(/エージェント/)).not.toBeInTheDocument()
    })

    it('items が空なら何も出さない', () => {
      render(<StatusBar agent={makeAgent({ items: [], needsAttention: false })} branch={null} />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(screen.queryByText(/エージェント/)).not.toBeInTheDocument()
    })

    it('まとめの文言と aria-label を持つボタンを出す', () => {
      render(<StatusBar agent={makeAgent()} branch={null} />)
      const button = screen.getByRole('button', {
        name: 'エージェント: 許可待ち 1 · 作業中 2（押すとターミナルを開きます）'
      })
      expect(button).toHaveTextContent('エージェント: 許可待ち 1 · 作業中 2')
      expect(button).toHaveAttribute('type', 'button')
    })

    it('ブランチの表示の後ろ(左側)に置く', () => {
      const { container } = render(<StatusBar agent={makeAgent()} branch={makeBranch()} />)
      const children = Array.from(container.querySelector('.status-bar')!.children)
      const branchIndex = children.findIndex((el) => el.textContent === 'main')
      const agentIndex = children.findIndex((el) => el.matches('.status-bar__agent'))
      const spacerIndex = children.findIndex((el) => el.matches('.status-bar__spacer'))
      expect(agentIndex).toBe(branchIndex + 1)
      expect(agentIndex).toBeLessThan(spacerIndex)
    })

    it('操作が必要なら強調の class を付け、そうでなければ付けない', () => {
      const { rerender } = render(<StatusBar agent={makeAgent()} branch={null} />)
      expect(screen.getByRole('button')).toHaveClass('status-bar__agent--attention')
      rerender(
        <StatusBar
          agent={makeAgent({ items: [{ activity: 'working', count: 1 }], needsAttention: false })}
          branch={null}
        />
      )
      expect(screen.getByRole('button')).not.toHaveClass('status-bar__agent--attention')
    })

    it('押すと onActivate を呼ぶ', async () => {
      const agent = makeAgent()
      render(<StatusBar agent={agent} branch={null} />)
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
    render(<StatusBar agent={makeAgent()} branch={null} />)
    const button = getComputedStyle(screen.getByRole('button'))
    expect(button.minHeight).toBe('32px')
    expect(button.boxSizing).toBe('border-box')
  })

  it('ステータスバーは 32px のボタンが入るよう、高さを固定しない', () => {
    const { container } = render(<StatusBar agent={makeAgent()} branch={null} />)
    const bar = getComputedStyle(container.querySelector('.status-bar') as HTMLElement)
    expect(bar.height).toBe('auto')
    expect(bar.minHeight).toBe('22px')
  })

  it('ブランチのボタンは既定の枠や背景を消し、ステータスバーの文字色を引き継ぐ', () => {
    render(<StatusBar agent={null} branch={makeBranch()} />)
    const button = getComputedStyle(screen.getByRole('button'))
    expect(button.borderStyle).toBe('none')
    expect(button.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(button.cursor).toBe('pointer')
  })

  it('同期のボタンは既定の枠や背景を消し、押せない間は既定のカーソルにする', () => {
    const { rerender } = render(<StatusBar agent={null} branch={makeBranch({ ahead: 1 })} />)
    const button = getComputedStyle(screen.getByRole('button', { name: /^変更を同期/ }))
    expect(button.borderStyle).toBe('none')
    expect(button.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(button.cursor).toBe('pointer')
    rerender(<StatusBar agent={null} branch={makeBranch({ ahead: 1, isSyncBlocked: true })} />)
    expect(getComputedStyle(screen.getByRole('button', { name: /^変更を同期/ })).cursor).toBe(
      'default'
    )
  })

  it('同期の失敗も、ブランチの失敗と同じ形で切り詰める', () => {
    render(<StatusBar agent={null} branch={makeBranch({ remoteError: new Error('失敗') })} />)
    const alert = getComputedStyle(screen.getByRole('alert'))
    expect(alert.textOverflow).toBe('ellipsis')
    expect(alert.backgroundColor).toBe('rgb(161, 38, 13)')
  })

  it('失敗のメッセージは幅が足りなければ省略記号で切り詰める', () => {
    render(<StatusBar agent={null} branch={makeBranch({ error: new Error('失敗') })} />)
    const alert = getComputedStyle(screen.getByRole('alert'))
    expect(alert.display).toBe('block')
    expect(alert.minWidth).toBe('0px')
    expect(alert.maxWidth).toBe('40vw')
    expect(alert.overflow).toBe('hidden')
    expect(alert.textOverflow).toBe('ellipsis')
    expect(alert.whiteSpace).toBe('nowrap')
    expect(alert.backgroundColor).toBe('rgb(161, 38, 13)')
  })

  it('長いブランチ名は幅が足りなければ省略記号で切り詰め、全文を title に入れる', () => {
    const branch = 'feature/とても長いブランチ名'
    render(<StatusBar agent={null} branch={makeBranch({ currentBranch: branch })} />)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('title', branch)
    expect(getComputedStyle(button).minWidth).toBe('0px')
    expect(getComputedStyle(button).maxWidth).toBe('40vw')
    const name = getComputedStyle(screen.getByText(branch))
    expect(name.minWidth).toBe('0px')
    expect(name.overflow).toBe('hidden')
    expect(name.textOverflow).toBe('ellipsis')
  })

  // jsdom は疑似クラスを評価しないため、ルールの宣言そのものを確かめる
  it('ブランチと同期のボタンの hover・focus-visible・disabled の宣言', () => {
    const declarationOf = (selector: string, property: string): string => {
      const rule = Array.from((styleElement.sheet as CSSStyleSheet).cssRules).find(
        (candidate): candidate is CSSStyleRule =>
          candidate instanceof CSSStyleRule && candidate.selectorText === selector
      )
      return rule?.style.getPropertyValue(property) ?? ''
    }
    // 明るくすると #007acc と白の文字の比が 4.5:1 を割る
    expect(declarationOf('.status-bar__branch:hover:not(:disabled)', 'background')).toBe(
      'rgba(0, 0, 0, 0.15)'
    )
    expect(declarationOf('.status-bar__branch:focus-visible', 'outline')).toBe('1px solid #ffffff')
    expect(declarationOf('.status-bar__branch:disabled', 'cursor')).toBe('default')
    expect(declarationOf('.status-bar__sync:hover:not(:disabled)', 'background')).toBe(
      'rgba(0, 0, 0, 0.15)'
    )
    expect(declarationOf('.status-bar__sync:focus-visible', 'outline')).toBe('1px solid #ffffff')
    expect(declarationOf('.status-bar__sync:disabled', 'cursor')).toBe('default')
  })
})
