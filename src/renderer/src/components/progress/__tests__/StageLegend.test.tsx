import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import StageLegend from '../StageLegend'
import { statusIcon, statusLabel } from '../../../lib/statusDisplay'

describe('StageLegend', () => {
  it('done のアイコンとラベルを表示する', () => {
    render(<StageLegend />)
    expect(screen.getByText(statusIcon('done'))).toBeInTheDocument()
    expect(screen.getByText(statusLabel('done'))).toBeInTheDocument()
  })

  it('in_progress のアイコンとラベルを表示する', () => {
    render(<StageLegend />)
    expect(screen.getByText(statusIcon('in_progress'))).toBeInTheDocument()
    expect(screen.getByText(statusLabel('in_progress'))).toBeInTheDocument()
  })

  it('not_started のアイコンとラベルを表示する', () => {
    render(<StageLegend />)
    expect(screen.getByText(statusIcon('not_started'))).toBeInTheDocument()
    expect(screen.getByText(statusLabel('not_started'))).toBeInTheDocument()
  })

  it('skipped のアイコンとラベルを表示する', () => {
    render(<StageLegend />)
    expect(screen.getByText(statusIcon('skipped'))).toBeInTheDocument()
    expect(screen.getByText(statusLabel('skipped'))).toBeInTheDocument()
  })

  it('aria-label="凡例" を持つ dl 要素を含む', () => {
    render(<StageLegend />)
    expect(screen.getByLabelText('凡例')).toBeInTheDocument()
  })
})
