import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { BooleanSettingPanelState } from '../../../types'
import BooleanSettingSection from '../BooleanSettingSection'

const TITLE = '節の名前'
const OPTION = 'チェックボックスのラベル'
const NOTE = '説明の文'

function renderSection(
  props: Partial<BooleanSettingPanelState> & { extraNote?: string | null } = {}
): void {
  render(
    <BooleanSettingSection
      title={TITLE}
      optionLabel={OPTION}
      note={NOTE}
      extraNote={props.extraNote}
      enabled={props.enabled === undefined ? true : props.enabled}
      saveError={props.saveError ?? null}
      onChange={props.onChange ?? vi.fn()}
    />
  )
}

describe('BooleanSettingSection', () => {
  it('節の名前をグループの名前に結び付け、見えているラベルを名前にしたチェックボックスが説明を参照する', () => {
    renderSection()
    const group = screen.getByRole('group', { name: TITLE })
    const checkbox = within(group).getByRole('checkbox', { name: OPTION })
    expect(checkbox).toBeChecked()
    expect(checkbox).toHaveAccessibleDescription(NOTE)
  })

  it('注記があれば説明の後ろに出し、チェックボックスの説明にも含める', () => {
    renderSection({ extraNote: '注記の文' })
    expect(screen.getByText('注記の文')).toHaveClass('settings-panel__note')
    expect(screen.getByRole('checkbox', { name: OPTION })).toHaveAccessibleDescription(
      `${NOTE} 注記の文`
    )
  })

  // 説明の文(accessible description)だけでは、出していない注記の id を並べても同じ文になり気付けないため、参照そのものを見る
  it('注記が無ければ、説明の段落だけを参照する(出していない注記の id を並べない)', () => {
    renderSection()
    expect(screen.getByRole('checkbox', { name: OPTION })).toHaveAttribute(
      'aria-describedby',
      screen.getByText(NOTE).id
    )
  })

  it('オフなら外れていて、押すと onChange(true)', async () => {
    const onChange = vi.fn()
    renderSection({ enabled: false, onChange })
    const checkbox = screen.getByRole('checkbox', { name: OPTION })
    expect(checkbox).not.toBeChecked()
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenLastCalledWith(true)
  })

  it('オンで押すと onChange(false)', async () => {
    const onChange = vi.fn()
    renderSection({ enabled: true, onChange })
    await userEvent.click(screen.getByRole('checkbox', { name: OPTION }))
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('読み込み中(null)は押せず、読み込み中と出す', () => {
    renderSection({ enabled: null })
    expect(screen.getByRole('checkbox', { name: OPTION })).toBeDisabled()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('読み込み後は押せて、読み込み中と出さない', () => {
    renderSection({ enabled: false })
    expect(screen.getByRole('checkbox', { name: OPTION })).toBeEnabled()
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
  })

  it('保存の失敗を role="alert" で出す', () => {
    renderSection({ saveError: '保存できませんでした: x' })
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした: x')
  })

  it('保存の失敗が無ければ alert を出さない', () => {
    renderSection()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('選択肢はタッチで押せる 32px 以上の高さ', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      renderSection()
      const label = screen.getByRole('checkbox', { name: OPTION }).closest('label')!
      expect(getComputedStyle(label).minHeight).toBe('32px')
    } finally {
      style.remove()
    }
  })
})
