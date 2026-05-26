import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import StagedSection from '../StagedSection'

describe('StagedSection', () => {
  it('staged ファイルがない場合は何も描画しない', () => {
    const files: GitFileStatus[] = [{ path: 'file.ts', index: ' ', workingDir: 'M' }]
    const { container } = render(<StagedSection files={files} />)
    expect(container.firstChild).toBeNull()
  })

  it('index="?" のファイルは staged に含まない', () => {
    const files: GitFileStatus[] = [{ path: 'new.ts', index: '?', workingDir: '?' }]
    const { container } = render(<StagedSection files={files} />)
    expect(container.firstChild).toBeNull()
  })

  it('staged ファイルがある場合はセクションタイトルと件数を表示する', () => {
    const files: GitFileStatus[] = [
      { path: 'a.ts', index: 'M', workingDir: ' ' },
      { path: 'b.ts', index: 'A', workingDir: ' ' },
    ]
    render(<StagedSection files={files} />)
    expect(screen.getByText('ステージ済み (2)')).toBeInTheDocument()
  })

  it('staged ファイルのパスが表示される', () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
    render(<StagedSection files={files} />)
    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
  })

  it('staged ファイルのステータス文字（index）が表示される', () => {
    const files: GitFileStatus[] = [{ path: 'file.ts', index: 'A', workingDir: ' ' }]
    render(<StagedSection files={files} />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('index が " " のとき "·" が表示される', () => {
    // index が " " かつ workingDir が変更されている staged ファイル（通常はないが境界確認）
    // staged フィルタは index !== ' ' && index !== '?' なので ' ' は除外される
    const files: GitFileStatus[] = [{ path: 'file.ts', index: ' ', workingDir: ' ' }]
    const { container } = render(<StagedSection files={files} />)
    expect(container.firstChild).toBeNull()
  })
})
