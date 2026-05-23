import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PanelContainer from '../PanelContainer'

describe('PanelContainer', () => {
  it('isActive=true のとき sidebar__panel クラスのみ付く', () => {
    const { container } = render(
      <PanelContainer isActive={true}>
        <div>content</div>
      </PanelContainer>
    )
    const el = container.firstChild as HTMLElement
    expect(el.className).toBe('sidebar__panel')
    expect(el.className).not.toContain('sidebar__panel--hidden')
  })

  it('isActive=false のとき sidebar__panel--hidden クラスが付く', () => {
    const { container } = render(
      <PanelContainer isActive={false}>
        <div>content</div>
      </PanelContainer>
    )
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain('sidebar__panel')
    expect(el.className).toContain('sidebar__panel--hidden')
  })

  it('children が正しくレンダリングされる', () => {
    render(
      <PanelContainer isActive={true}>
        <span>panel content</span>
      </PanelContainer>
    )
    expect(screen.getByText('panel content')).toBeDefined()
  })

  it('isActive が切り替わると className が変わる', () => {
    const { container, rerender } = render(
      <PanelContainer isActive={true}>
        <div />
      </PanelContainer>
    )
    const el = container.firstChild as HTMLElement
    expect(el.className).not.toContain('sidebar__panel--hidden')

    rerender(
      <PanelContainer isActive={false}>
        <div />
      </PanelContainer>
    )
    expect(el.className).toContain('sidebar__panel--hidden')
  })
})
