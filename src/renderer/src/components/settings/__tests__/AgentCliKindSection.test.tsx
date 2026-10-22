import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import AgentCliKindSection from '../AgentCliKindSection'
import type { AgentCliKindPanelState } from '../../../types'

const LOCKED = 'エージェントの起動中は、使う CLI を切り替えられません'

const props = (overrides: Partial<AgentCliKindPanelState> = {}): AgentCliKindPanelState => ({
  kind: 'claude',
  fallback: null,
  saveError: null,
  isLocked: false,
  isSwitching: false,
  lockedReason: null,
  onSelect: vi.fn(),
  ...overrides
})

describe('AgentCliKindSection', () => {
  it('見出しを名前にした radiogroup に 2 つの radio を出し、選択中を aria-checked で示す。説明も出す', () => {
    render(<AgentCliKindSection {...props()} />)
    expect(screen.getByRole('radiogroup', { name: '使うエージェント CLI' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Claude Code（claude）' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: 'GitHub Copilot CLI（copilot）' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(
      screen.getByText('エージェント CLI 方式で使います。切り替えると、次の起動から使われます')
    ).toBeInTheDocument()
  })

  it('選ぶと onSelect を呼ぶ。選択中のものを押しても呼ばない', async () => {
    const onSelect = vi.fn()
    render(<AgentCliKindSection {...props({ onSelect })} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Claude Code（claude）' }))
    await userEvent.click(screen.getByRole('radio', { name: 'GitHub Copilot CLI（copilot）' }))
    expect(onSelect.mock.calls).toEqual([['copilot']])
  })

  it('保存されていた値が不正(invalid-value)な間は、選択中のものを押しても onSelect を呼ぶ(注記の「選び直すと保存します」のとおり)', async () => {
    const onSelect = vi.fn()
    render(<AgentCliKindSection {...props({ fallback: 'invalid-value', onSelect })} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Claude Code（claude）' }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('claude')
  })

  it('設定ファイルを読めなかった(read-failed)間は、選択中のものを押しても呼ばない(注記は保存を約束していない)', async () => {
    const onSelect = vi.fn()
    render(<AgentCliKindSection {...props({ fallback: 'read-failed', onSelect })} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Claude Code（claude）' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('読み込み中(kind が null)は選べず、読み込み中と出す(isLocked が false でも)', () => {
    render(<AgentCliKindSection {...props({ kind: null })} />)
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('押す前から選べない間(起動中など。isLocked)は disabled', () => {
    render(<AgentCliKindSection {...props({ isLocked: true })} />)
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
  })

  // 押した結果として切り替えの途中になる。disabled だとフォーカスを持つ選択肢が押せなくなってフォーカスが body に落ちるため、
  // aria-disabled にして押しても onSelect を呼ばない(L-157)
  it('押した後の切り替えの途中(isSwitching)は disabled にせず aria-disabled にし、フォーカスが押した選択肢に残る。途中で押しても onSelect を呼ばない', async () => {
    const onSelect = vi.fn()
    function Harness(): React.JSX.Element {
      const [isSwitching, setIsSwitching] = useState(false)
      return (
        <AgentCliKindSection
          {...props({
            isSwitching,
            onSelect: (kind) => {
              onSelect(kind)
              setIsSwitching(true)
            }
          })}
        />
      )
    }
    render(<Harness />)
    const copilot = screen.getByRole('radio', { name: 'GitHub Copilot CLI（copilot）' })
    await userEvent.click(copilot)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('copilot')
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeDisabled()
      expect(radio).toHaveAttribute('aria-disabled', 'true')
    }
    expect(document.activeElement).toBe(copilot)
    await userEvent.click(copilot)
    await userEvent.keyboard(' ')
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('切り替えの途中は、不正な値の間に選択中のものを押し直しても onSelect を呼ばない', async () => {
    const onSelect = vi.fn()
    render(
      <AgentCliKindSection {...props({ fallback: 'invalid-value', isSwitching: true, onSelect })} />
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Claude Code（claude）' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('切り替えの途中でなければ aria-disabled を付けない', () => {
    render(<AgentCliKindSection {...props()} />)
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toHaveAttribute('aria-disabled')
    }
  })

  it('起動中の理由を出し、選択肢から aria-describedby で参照する', () => {
    render(<AgentCliKindSection {...props({ isLocked: true, lockedReason: LOCKED })} />)
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled()
      expect(radio).toHaveAccessibleDescription(LOCKED)
    }
  })

  it('切り替えの途中(isSwitching)の理由も出し、aria-disabled のまま選択肢から aria-describedby で参照する', () => {
    render(
      <AgentCliKindSection
        {...props({ isSwitching: true, lockedReason: '使うエージェント CLI を切り替えています' })}
      />
    )
    const reason = screen.getByText('使うエージェント CLI を切り替えています')
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeDisabled()
      expect(radio).toHaveAttribute('aria-disabled', 'true')
      expect(radio).toHaveAccessibleDescription('使うエージェント CLI を切り替えています')
      expect(radio.getAttribute('aria-describedby')).toBe(reason.id)
    }
  })

  it('copilot を選んでいると、使えない機能の注記に能力の表で使えない機能(区別・再開)を出す', () => {
    render(<AgentCliKindSection {...props({ kind: 'copilot' })} />)
    expect(
      screen.getByText(
        'copilot では次の機能を使えません（ターミナルで直接操作します）: 利用者の変更との区別、前回の続きから・このセッションで再開'
      )
    ).toBeInTheDocument()
  })

  it('claude では使えない機能の注記を出さない', () => {
    render(<AgentCliKindSection {...props()} />)
    expect(screen.queryByText(/では次の機能を使えません/)).toBeNull()
  })

  it.each([
    [
      'invalid-value',
      '保存されていた値を読めなかったため claude を使っています（選び直すと保存します）'
    ],
    ['read-failed', '設定ファイルを読めなかったため claude を使っています']
  ] as const)('既定に戻した旨(%s)を role="alert" にせずに出す', (fallback, text) => {
    render(<AgentCliKindSection {...props({ fallback })} />)
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('保存の失敗を role="alert" で出す', () => {
    render(
      <AgentCliKindSection
        {...props({ saveError: '使うエージェント CLI を保存できませんでした: x' })}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      '使うエージェント CLI を保存できませんでした: x'
    )
  })
})
