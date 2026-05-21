import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ExplorerIcon from '../ExplorerIcon'
import GitIcon from '../GitIcon'
import PromptIcon from '../PromptIcon'
import SettingsIcon from '../SettingsIcon'
import BranchIcon from '../BranchIcon'

const iconComponents = [
  { name: 'ExplorerIcon', Component: ExplorerIcon },
  { name: 'GitIcon', Component: GitIcon },
  { name: 'PromptIcon', Component: PromptIcon },
  { name: 'SettingsIcon', Component: SettingsIcon },
  { name: 'BranchIcon', Component: BranchIcon },
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
})
