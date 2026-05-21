import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Sidebar from '../Sidebar'
import { sidebarTitles, sidebarPlaceholders } from '../../config/sidebarTitles'

describe('Sidebar', () => {
  it('explorer: 正しいヘッダーとプレースホルダーが表示される', () => {
    render(<Sidebar activePanel="explorer" />)
    expect(screen.getByText(sidebarTitles.explorer)).toBeInTheDocument()
    expect(screen.getByText(sidebarPlaceholders.explorer)).toBeInTheDocument()
  })

  it('source-control: 正しいヘッダーとプレースホルダーが表示される', () => {
    render(<Sidebar activePanel="source-control" />)
    expect(screen.getByText(sidebarTitles['source-control'])).toBeInTheDocument()
    expect(screen.getByText(sidebarPlaceholders['source-control'])).toBeInTheDocument()
  })

  it('prompts: 正しいヘッダーとプレースホルダーが表示される', () => {
    render(<Sidebar activePanel="prompts" />)
    expect(screen.getByText(sidebarTitles.prompts)).toBeInTheDocument()
    expect(screen.getByText(sidebarPlaceholders.prompts)).toBeInTheDocument()
  })
})
