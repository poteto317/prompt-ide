import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import ChangesSection from '../ChangesSection'

describe('ChangesSection', () => {
  it('changed ファイルがない場合は何も描画しない', () => {
    const files: GitFileStatus[] = [{ path: 'file.ts', index: 'M', workingDir: ' ' }]
    const { container } = render(<ChangesSection files={files} />)
    expect(container.firstChild).toBeNull()
  })

  it('changed ファイルがある場合はセクションタイトルと件数を表示する', () => {
    const files: GitFileStatus[] = [
      { path: 'a.ts', index: ' ', workingDir: 'M' },
      { path: 'b.ts', index: ' ', workingDir: 'D' },
    ]
    render(<ChangesSection files={files} />)
    expect(screen.getByText('変更 (2)')).toBeInTheDocument()
  })

  it('changed ファイルのパスが表示される', () => {
    const files: GitFileStatus[] = [{ path: 'README.md', index: ' ', workingDir: 'M' }]
    render(<ChangesSection files={files} />)
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('未追跡ファイル（index="?"）は "U" で表示される', () => {
    const files: GitFileStatus[] = [{ path: 'new-file.ts', index: '?', workingDir: '?' }]
    render(<ChangesSection files={files} />)
    expect(screen.getByText('U')).toBeInTheDocument()
    expect(screen.getByText('new-file.ts')).toBeInTheDocument()
  })

  it('作業ツリー変更ファイルに statusChar が適用される', () => {
    const files: GitFileStatus[] = [{ path: 'file.ts', index: ' ', workingDir: 'M' }]
    render(<ChangesSection files={files} />)
    expect(screen.getByText('M')).toBeInTheDocument()
  })

  it('index も workingDir も変更なし（" "）のときは何も描画しない', () => {
    // workingDir=' ' && index!='?' → フィルターで除外 → セクション非表示
    const files: GitFileStatus[] = [{ path: 'file.ts', index: ' ', workingDir: ' ' }]
    const { container } = render(<ChangesSection files={files} />)
    expect(container.firstChild).toBeNull()
  })
})
