import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ExplorerIcon from '../ExplorerIcon'
import GitIcon from '../GitIcon'
import PromptIcon from '../PromptIcon'
import SettingsIcon from '../SettingsIcon'
import BranchIcon from '../BranchIcon'
import CloudIcon from '../CloudIcon'
import TagIcon from '../TagIcon'

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
})
