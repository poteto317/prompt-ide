import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import QuickOpenItem from '../QuickOpenItem'
import type { QuickOpenResult } from '../../../lib/quickOpenSearch'

const result: QuickOpenResult = {
  node: { name: 'useFileSystem.ts', path: '/project/src/hooks/useFileSystem.ts', type: 'file' },
  directory: 'src/hooks',
  score: 100,
  matchedName: true,
  nameIndices: [0, 1, 3, 7],
  directoryIndices: []
}

const defaultProps = {
  id: 'quick-open-option-0',
  result,
  isActive: false,
  onSelect: vi.fn(),
  onHover: vi.fn()
}

describe('QuickOpenItem', () => {
  it('ファイル名とディレクトリを表示する', () => {
    render(<QuickOpenItem {...defaultProps} />)
    expect(screen.getByRole('option')).toHaveTextContent('useFileSystem.ts')
    expect(screen.getByRole('option')).toHaveTextContent('src/hooks')
  })

  it('ルート直下のファイルではディレクトリを表示しない', () => {
    render(
      <QuickOpenItem
        {...defaultProps}
        result={{
          ...result,
          node: { name: 'README.md', path: '/project/README.md', type: 'file' },
          directory: '',
          nameIndices: []
        }}
      />
    )
    expect(screen.getByRole('option')).toHaveTextContent('README.md')
    expect(screen.queryByTestId('quick-open-directory')).not.toBeInTheDocument()
  })

  it('ファイル名のマッチ位置をハイライトする', () => {
    const { container } = render(<QuickOpenItem {...defaultProps} />)
    const marks = Array.from(container.querySelectorAll('mark')).map((el) => el.textContent)
    expect(marks).toEqual(['us', 'F', 'S'])
  })

  it('ディレクトリのマッチ位置をハイライトする', () => {
    const { container } = render(
      <QuickOpenItem
        {...defaultProps}
        result={{ ...result, nameIndices: [], directoryIndices: [4, 5, 6, 7, 8] }}
      />
    )
    const marks = Array.from(container.querySelectorAll('mark')).map((el) => el.textContent)
    expect(marks).toEqual(['hooks'])
  })

  it('マッチが無いときハイライトを描画しない', () => {
    const { container } = render(
      <QuickOpenItem {...defaultProps} result={{ ...result, nameIndices: [] }} />
    )
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  it('選択中のとき aria-selected が true になる', () => {
    render(<QuickOpenItem {...defaultProps} isActive />)
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true')
  })

  it('非選択のとき aria-selected が false になる', () => {
    render(<QuickOpenItem {...defaultProps} />)
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'false')
  })

  it('id 属性に渡された id を設定する(aria-activedescendant 参照用)', () => {
    render(<QuickOpenItem {...defaultProps} />)
    expect(screen.getByRole('option')).toHaveAttribute('id', 'quick-open-option-0')
  })

  it('クリックで onSelect が呼ばれる', async () => {
    const onSelect = vi.fn()
    render(<QuickOpenItem {...defaultProps} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('option'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('マウスオーバーで onHover が呼ばれる', async () => {
    const onHover = vi.fn()
    render(<QuickOpenItem {...defaultProps} onHover={onHover} />)
    await userEvent.hover(screen.getByRole('option'))
    expect(onHover).toHaveBeenCalled()
  })
})
