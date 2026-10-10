import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { AgentAddedReference, AgentReferenceChipState } from '../../../types'
import { makeAgentReferencesPanelState } from '../../../__tests__/makeAgentReferencesState'
import AgentReferenceChips from '../AgentReferenceChips'

const getGroup = (): HTMLElement => screen.getByRole('group', { name: '参照' })

// 押せるチップ
const chip = (
  overrides: Partial<Extract<AgentReferenceChipState, { disabledReason: null }>> = {}
): AgentReferenceChipState => ({
  label: '@src/app.ts',
  disabledReason: null,
  pressed: false,
  unsaved: false,
  onToggle: vi.fn(),
  ...overrides
})

// 押せないチップ(理由を出す)
const disabledChip = (reason: string, pressed = false): AgentReferenceChipState => ({
  label: null,
  disabledReason: reason,
  pressed,
  unsaved: false,
  onToggle: vi.fn()
})

const notes: AgentAddedReference = {
  path: '/repo/docs/notes.md',
  label: '@docs/notes.md',
  unsaved: false
}
const other: AgentAddedReference = {
  path: '/repo/docs/other.md',
  label: '@docs/other.md',
  unsaved: false
}

// 外すと一覧から消える(本物の useAgentReferences と同じく、次の描画で added が変わる)
function Harness({ initial }: { initial: AgentAddedReference[] }): React.JSX.Element {
  const [added, setAdded] = useState(initial)
  return (
    <AgentReferenceChips
      state={makeAgentReferencesPanelState({
        added,
        onRemove: (path) => setAdded((prev) => prev.filter((item) => item.path !== path))
      })}
    />
  )
}

describe('AgentReferenceChips', () => {
  it('名前「参照」のグループに、開いているファイル・選択範囲のチップを aria-pressed 付きで出す', () => {
    render(
      <AgentReferenceChips
        state={makeAgentReferencesPanelState({
          openFile: chip({ pressed: true }),
          selection: chip({ label: '@src/app.ts#L10-20' })
        })}
      />
    )
    const group = getGroup()
    expect(within(group).getByRole('button', { name: '@src/app.ts' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(group).getByRole('button', { name: '@src/app.ts#L10-20' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('押すと onToggle を呼ぶ。押せるチップの title は何を添えるかの説明', async () => {
    const openFile = chip()
    render(<AgentReferenceChips state={makeAgentReferencesPanelState({ openFile })} />)
    const button = screen.getByRole('button', { name: '@src/app.ts' })
    expect(button).toHaveAttribute('title', '開いているファイルを参照として添える')
    await userEvent.click(button)
    expect(openFile.onToggle).toHaveBeenCalledOnce()
  })

  it('押せないチップは、パスの代わりに見出しの文言を出して押せなくし、理由を title と説明で出す', () => {
    render(
      <AgentReferenceChips
        state={makeAgentReferencesPanelState({
          openFile: disabledChip('開いているファイルがありません'),
          selection: disabledChip('エディタで範囲を選ぶと添えられます')
        })}
      />
    )
    const openFile = screen.getByRole('button', { name: '開いているファイル' })
    expect(openFile).toBeDisabled()
    expect(openFile).toHaveAttribute('title', '開いているファイルがありません')
    const selection = screen.getByRole('button', { name: '選択範囲' })
    expect(selection).toBeDisabled()
    // 説明は title へのフォールバックでは通るため、aria-describedby の参照先の文字を直接確かめる
    const describedText = (button: HTMLElement): string | null => {
      const id = button.getAttribute('aria-describedby')
      return id === null ? null : (document.getElementById(id)?.textContent ?? null)
    }
    expect(describedText(openFile)).toBe('開いているファイルがありません')
    expect(describedText(selection)).toBe('エディタで範囲を選ぶと添えられます')
  })

  it('オンのまま押せなくなったチップは、押せないまま aria-pressed でオンを伝える', () => {
    render(
      <AgentReferenceChips
        state={makeAgentReferencesPanelState({
          openFile: disabledChip('差分のタブは参照にできません', true)
        })}
      />
    )
    const openFile = screen.getByRole('button', { name: '開いているファイル' })
    expect(openFile).toBeDisabled()
    expect(openFile).toHaveAttribute('aria-pressed', 'true')
  })

  it('押せるチップには aria-describedby を付けない', () => {
    render(<AgentReferenceChips state={makeAgentReferencesPanelState({ openFile: chip() })} />)
    expect(screen.getByRole('button', { name: '@src/app.ts' })).not.toHaveAttribute(
      'aria-describedby'
    )
  })

  it('未保存なら「未保存」の印を付け、名前は見えている文字そのもの(L-156)', () => {
    render(
      <AgentReferenceChips
        state={makeAgentReferencesPanelState({ openFile: chip({ pressed: true, unsaved: true }) })}
      />
    )
    expect(screen.getByRole('button', { name: '@src/app.ts 未保存' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('エクスプローラから足したファイルを外すボタン付きで出し、押すと onRemove に絶対パスを渡す', async () => {
    const onRemove = vi.fn()
    render(
      <AgentReferenceChips state={makeAgentReferencesPanelState({ added: [notes], onRemove })} />
    )
    expect(within(getGroup()).getByText('@docs/notes.md')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '@docs/notes.md を参照から外す' }))
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('/repo/docs/notes.md')
  })

  it('足したファイルが未保存なら、開いているファイルのチップと同じ「未保存」の印を名前の後に付ける', () => {
    render(
      <AgentReferenceChips
        state={makeAgentReferencesPanelState({ added: [{ ...notes, unsaved: true }, other] })}
      />
    )
    const group = getGroup()
    const mark = within(group).getByText('未保存')
    expect(mark).toHaveClass('agent-references__unsaved')
    // 見えている文字は「@docs/notes.md 未保存」(開いているファイルのチップと同じ並び)
    expect(mark.closest('.agent-references__chip-label')).toHaveTextContent(
      /^@docs\/notes\.md 未保存$/
    )
    // 未保存でない足したファイルには付けない
    expect(within(group).getAllByText('未保存')).toHaveLength(1)
    expect(within(group).getByText('@docs/other.md')).toBeInTheDocument()
  })

  it('外した後は、同じ位置の次の外すボタンへ、無ければ参照の行へフォーカスを移す(body に落とさない)', async () => {
    render(<Harness initial={[notes, other]} />)
    await userEvent.click(screen.getByRole('button', { name: '@docs/notes.md を参照から外す' }))
    expect(screen.getByRole('button', { name: '@docs/other.md を参照から外す' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: '@docs/other.md を参照から外す' }))
    expect(getGroup()).toHaveFocus()
  })

  it('押せるチップだけが押せる見た目(ポインタ)で、足したファイルのチップの入れ物と押せないチップは押せる見た目にしない', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      render(
        <AgentReferenceChips
          state={makeAgentReferencesPanelState({
            selection: disabledChip('エディタで範囲を選ぶと添えられます'),
            added: [notes]
          })}
        />
      )
      const toggle = screen.getByRole('button', { name: '@src/app.ts' })
      expect(getComputedStyle(toggle).cursor).toBe('pointer')
      expect(getComputedStyle(screen.getByRole('button', { name: /選択範囲/ })).cursor).toBe(
        'default'
      )
      // 入れ物は span で押せない(押せるのは中の × だけ)。チップの形は押せるチップと共有する
      const added = screen.getByText('@docs/notes.md').parentElement as HTMLElement
      expect(getComputedStyle(added).cursor).not.toBe('pointer')
      expect(getComputedStyle(added).minHeight).toBe(getComputedStyle(toggle).minHeight)
      expect(getComputedStyle(added).borderRadius).toBe(getComputedStyle(toggle).borderRadius)
    } finally {
      style.remove()
    }
  })

  it('参照の行(全部外した後のフォーカスの置き場)は、キーボードのフォーカスに枠を出し、マウスのときだけ枠を消す', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      // jsdom は :focus-visible を計算しないため、規則そのものを CSSOM から探す
      const rules = Array.from(style.sheet?.cssRules ?? []).filter(
        (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule
      )
      const findRule = (selector: string): CSSStyleRule | undefined =>
        rules.find((r) => r.selectorText.split(/,\s*/).includes(selector))
      const focusVisible = findRule('.agent-references:focus-visible')
      expect(focusVisible).toBeDefined()
      // ほかの要素の :focus-visible と同じ枠(1px の実線、#007acc)。行の内側に描く
      expect(focusVisible?.style.getPropertyValue('outline')).toBe('1px solid #007acc')
      expect(focusVisible?.style.outlineOffset).toBe('-1px')
      // :focus の枠をまとめて消す規則は置かない(キーボードのフォーカスの枠まで消える)
      expect(findRule('.agent-references:focus')).toBeUndefined()
      expect(findRule('.agent-references:focus:not(:focus-visible)')?.style.outline).toBe('none')
    } finally {
      style.remove()
    }
  })

  it('押せないチップの理由は読み上げの順番に出さず(hidden)、ボタンの説明としてだけ読まれる', () => {
    render(
      <AgentReferenceChips
        state={makeAgentReferencesPanelState({
          openFile: disabledChip('開いているファイルがありません'),
          selection: disabledChip('エディタで範囲を選ぶと添えられます')
        })}
      />
    )
    const group = getGroup()
    for (const [name, reason] of [
      ['開いているファイル', '開いているファイルがありません'],
      ['選択範囲', 'エディタで範囲を選ぶと添えられます']
    ]) {
      const button = within(group).getByRole('button', { name })
      // 理由の要素は hidden(アクセシビリティツリーに出ない)。説明(aria-describedby)は隠した要素の文言も使える
      const reasonElement = document.getElementById(button.getAttribute('aria-describedby') ?? '')
      expect(reasonElement).toHaveAttribute('hidden')
      expect(reasonElement).toHaveTextContent(reason)
      expect(button).toHaveAccessibleDescription(reason)
      // 読み上げの順番(アクセシビリティツリー)にテキストとして出ない
      expect(within(group).queryByText(reason)).not.toBeVisible()
    }
  })

  it('差分のタブ・フォルダの外の理由は、参照の行に画面の文字として出す(読み上げは説明だけで、見える文字は aria-hidden)', () => {
    for (const reason of [
      '差分のタブは参照にできません',
      'フォルダの外のファイルは参照にできません'
    ]) {
      const { unmount } = render(
        <AgentReferenceChips
          state={makeAgentReferencesPanelState({
            openFile: disabledChip(reason),
            selection: disabledChip('エディタで範囲を選ぶと添えられます')
          })}
        />
      )
      const group = getGroup()
      const visible = Array.from(group.querySelectorAll('.agent-references__visible-reason'))
      expect(visible).toHaveLength(1)
      expect(visible[0]).toHaveTextContent(reason)
      expect(visible[0]).toBeVisible()
      // 説明として読まれるので、見える文字は読み上げの順番に出さない(二重に読まれないように)
      expect(visible[0]).toHaveAttribute('aria-hidden', 'true')
      // 読み上げの説明は hidden の要素から引いたまま
      const button = within(group).getByRole('button', { name: '開いているファイル' })
      expect(button).toHaveAccessibleDescription(reason)
      expect(
        document.getElementById(button.getAttribute('aria-describedby') ?? '')
      ).toHaveAttribute('hidden')
      unmount()
    }
  })

  it('開いているファイルが無い・範囲を選んでいない(見れば分かる理由)は、画面の文字として出さない', () => {
    render(
      <AgentReferenceChips
        state={makeAgentReferencesPanelState({
          openFile: disabledChip('開いているファイルがありません'),
          selection: disabledChip('エディタで範囲を選ぶと添えられます')
        })}
      />
    )
    expect(getGroup().querySelector('.agent-references__visible-reason')).toBeNull()
  })

  it('2 つのチップが同じ理由で押せないとき(差分のタブ)は、画面の文字を 1 回だけ出す', () => {
    render(
      <AgentReferenceChips
        state={makeAgentReferencesPanelState({
          openFile: disabledChip('差分のタブは参照にできません'),
          selection: disabledChip('差分のタブは参照にできません')
        })}
      />
    )
    const visible = getGroup().querySelectorAll('.agent-references__visible-reason')
    expect(visible).toHaveLength(1)
    expect(visible[0]).toHaveTextContent('差分のタブは参照にできません')
    // 説明は両方のチップから引ける
    expect(screen.getByRole('button', { name: '開いているファイル' })).toHaveAccessibleDescription(
      '差分のタブは参照にできません'
    )
    expect(screen.getByRole('button', { name: '選択範囲' })).toHaveAccessibleDescription(
      '差分のタブは参照にできません'
    )
  })

  it('画面に出す理由は、プロンプトの実行の理由と同じ見た目で、チップの下の行に出す', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      render(
        <AgentReferenceChips
          state={makeAgentReferencesPanelState({
            openFile: disabledChip('差分のタブは参照にできません')
          })}
        />
      )
      const visible = getGroup().querySelector('.agent-references__visible-reason') as HTMLElement
      const computed = getComputedStyle(visible)
      expect(computed.color).toBe('rgb(150, 150, 150)')
      expect(computed.fontSize).toBe('12px')
      expect(computed.flexBasis).toBe('100%')
    } finally {
      style.remove()
    }
  })

  it('チップと外すボタンはタッチで押せる大きさ(32px 以上)', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      render(<AgentReferenceChips state={makeAgentReferencesPanelState({ added: [notes] })} />)
      expect(getComputedStyle(screen.getByRole('button', { name: '@src/app.ts' })).minHeight).toBe(
        '32px'
      )
      const remove = screen.getByRole('button', { name: '@docs/notes.md を参照から外す' })
      expect(getComputedStyle(remove).minHeight).toBe('32px')
      expect(getComputedStyle(remove).minWidth).toBe('32px')
    } finally {
      style.remove()
    }
  })
})
