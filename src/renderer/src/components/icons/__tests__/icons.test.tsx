import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ExplorerIcon from '../ExplorerIcon'
import GitIcon from '../GitIcon'
import PromptIcon from '../PromptIcon'
import SettingsIcon from '../SettingsIcon'
import BranchIcon from '../BranchIcon'
import CloudIcon from '../CloudIcon'
import TagIcon from '../TagIcon'
import ChevronIcon from '../ChevronIcon'

const iconComponents = [
  { name: 'ExplorerIcon', Component: ExplorerIcon },
  { name: 'GitIcon', Component: GitIcon },
  { name: 'PromptIcon', Component: PromptIcon },
  { name: 'SettingsIcon', Component: SettingsIcon },
  { name: 'BranchIcon', Component: BranchIcon },
  { name: 'CloudIcon', Component: CloudIcon },
  { name: 'TagIcon', Component: TagIcon }
]

describe('Icons', () => {
  iconComponents.forEach(({ name, Component }) => {
    it(`${name}: SVG に aria-hidden="true" が設定されている`, () => {
      const { container } = render(<Component />)
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    })
  })

  it('ChevronIcon: 指定した向きで描き、読み上げない', () => {
    const { container, rerender } = render(<ChevronIcon direction="down" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('data-direction', 'down')
    expect(container.querySelector('path')).toHaveAttribute('d', 'M5 9l7 7 7-7')
    rerender(<ChevronIcon direction="right" />)
    expect(container.querySelector('svg')).toHaveAttribute('data-direction', 'right')
    expect(container.querySelector('path')).toHaveAttribute('d', 'M9 5l7 7-7 7')
  })
})
