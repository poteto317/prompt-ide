import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AgentAnnouncer from '../AgentAnnouncer'

describe('AgentAnnouncer', () => {
  it('polite・atomic の常設の領域に文言を出し、同じ要素の文言を入れ替える', () => {
    const { rerender } = render(<AgentAnnouncer message="claude 1 が許可待ちになりました" />)
    const region = screen.getByText('claude 1 が許可待ちになりました')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveAttribute('aria-atomic', 'true')
    rerender(<AgentAnnouncer message="claude 1 の作業が終わりました" />)
    expect(screen.getByText('claude 1 の作業が終わりました')).toBe(region)
  })

  it('文言が空でも領域は残す(後から入れた文言を読み上げるため)', () => {
    const { container } = render(<AgentAnnouncer message="" />)
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull()
  })
})
