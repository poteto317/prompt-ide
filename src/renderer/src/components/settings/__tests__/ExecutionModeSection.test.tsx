import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ExecutionModeSection from '../ExecutionModeSection'

describe('ExecutionModeSection', () => {
  it('見出しを名前にした radiogroup に 2 つの radio を出し、選択中を aria-checked で示す', () => {
    render(
      <ExecutionModeSection
        mode="agent-cli"
        saveError={null}
        isLocked={false}
        isSwitching={false}
        onSelect={vi.fn()}
      />
    )
    const group = screen.getByRole('radiogroup', { name: 'プロンプトの実行方式' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^エージェント CLI/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: /^従来の方式/ })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('選ぶと onSelect を呼ぶ。選択中のものを押しても呼ばない', async () => {
    const onSelect = vi.fn()
    render(
      <ExecutionModeSection
        mode="agent-cli"
        saveError={null}
        isLocked={false}
        isSwitching={false}
        onSelect={onSelect}
      />
    )
    await userEvent.click(screen.getByRole('radio', { name: /^エージェント CLI/ }))
    await userEvent.click(screen.getByRole('radio', { name: /^従来の方式/ }))
    expect(onSelect.mock.calls).toEqual([['legacy']])
  })

  it('読み込み中は選べず、読み込み中と出す', () => {
    render(
      <ExecutionModeSection
        mode={null}
        saveError={null}
        isLocked
        isSwitching={false}
        onSelect={vi.fn()}
      />
    )
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('isLocked が false でも mode が null(読み込み中)なら選べない', () => {
    render(
      <ExecutionModeSection
        mode={null}
        saveError={null}
        isLocked={false}
        isSwitching={false}
        onSelect={vi.fn()}
      />
    )
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
  })

  it('保存の失敗を role="alert" で出す', () => {
    render(
      <ExecutionModeSection
        mode="agent-cli"
        saveError="実行方式を保存できませんでした: x"
        isLocked={false}
        isSwitching={false}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('実行方式を保存できませんでした: x')
  })

  it('選べない理由があれば出し、選択肢から参照する', () => {
    render(
      <ExecutionModeSection
        mode="legacy"
        saveError={null}
        isLocked
        isSwitching={false}
        lockedReason="従来の方式で実行している間は、実行方式を切り替えられません"
        onSelect={vi.fn()}
      />
    )
    const reason = screen.getByText('従来の方式で実行している間は、実行方式を切り替えられません')
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled()
      expect(radio).toHaveAccessibleDescription(
        '従来の方式で実行している間は、実行方式を切り替えられません'
      )
      expect(radio.getAttribute('aria-describedby')).toBe(reason.id)
    }
  })

  it('切り替えの途中(isSwitching)の理由も出し、aria-disabled のまま選択肢から参照する', () => {
    render(
      <ExecutionModeSection
        mode="agent-cli"
        saveError={null}
        isLocked={false}
        isSwitching
        lockedReason="使うエージェント CLI を切り替えています"
        onSelect={vi.fn()}
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

  it('選べない理由が無ければ、理由も参照も出さない', () => {
    render(
      <ExecutionModeSection
        mode="legacy"
        saveError={null}
        isLocked={false}
        isSwitching={false}
        onSelect={vi.fn()}
      />
    )
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toHaveAttribute('aria-describedby')
    }
  })

  it('押す前から選べない間(isLocked)は disabled', () => {
    render(
      <ExecutionModeSection
        mode="legacy"
        saveError={null}
        isLocked
        isSwitching={false}
        onSelect={vi.fn()}
      />
    )
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled()
      expect(radio).not.toHaveAttribute('aria-disabled')
    }
  })

  // 押した結果として切り替えの途中になる。disabled だとフォーカスを持つ選択肢が押せなくなってフォーカスが body に落ちるため、
  // aria-disabled にして押しても onSelect を呼ばない(L-157)
  it('押した後の切り替えの途中(isSwitching)は disabled にせず aria-disabled にし、フォーカスが押した選択肢に残る。途中で押しても onSelect を呼ばない', async () => {
    const onSelect = vi.fn()
    function Harness(): React.JSX.Element {
      const [isSwitching, setIsSwitching] = useState(false)
      return (
        <ExecutionModeSection
          mode="agent-cli"
          saveError={null}
          isLocked={false}
          isSwitching={isSwitching}
          onSelect={(mode) => {
            onSelect(mode)
            setIsSwitching(true)
          }}
        />
      )
    }
    render(<Harness />)
    const legacy = screen.getByRole('radio', { name: /^従来の方式/ })
    await userEvent.click(legacy)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('legacy')
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeDisabled()
      expect(radio).toHaveAttribute('aria-disabled', 'true')
    }
    expect(document.activeElement).toBe(legacy)
    await userEvent.click(legacy)
    await userEvent.keyboard(' ')
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('エージェント CLI の選択肢は特定の CLI の名前を書かない(使う CLI は別の節で選ぶ)', () => {
    render(
      <ExecutionModeSection
        mode="agent-cli"
        saveError={null}
        isLocked={false}
        isSwitching={false}
        onSelect={vi.fn()}
      />
    )
    expect(
      screen.getByRole('radio', {
        name: 'エージェント CLI（アプリ内のターミナルでエージェント CLI を動かす）'
      })
    ).toBeInTheDocument()
  })
})
