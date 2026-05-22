import { describe, it, expect } from 'vitest'
import type { FileNode } from '../../types'
import { createOpenFile } from '../fileUtils'

describe('createOpenFile', () => {
  const node: FileNode = {
    name: 'index.ts',
    path: '/project/src/index.ts',
    type: 'file',
  }

  it('path / name / content が node とコンテンツから正しく設定される', () => {
    const result = createOpenFile(node, 'const x = 1')
    expect(result.path).toBe('/project/src/index.ts')
    expect(result.name).toBe('index.ts')
    expect(result.content).toBe('const x = 1')
  })

  it('language が detectLanguage(node.name) の結果と一致する', () => {
    const result = createOpenFile(node, '')
    expect(result.language).toBe('typescript')
  })

  it('異なる拡張子のファイルで正しい language が設定される', () => {
    const jsonNode: FileNode = { name: 'package.json', path: '/p/package.json', type: 'file' }
    expect(createOpenFile(jsonNode, '{}').language).toBe('json')

    const mdNode: FileNode = { name: 'README.md', path: '/p/README.md', type: 'file' }
    expect(createOpenFile(mdNode, '# Hi').language).toBe('markdown')
  })

  it('空コンテンツでも正しく構築される', () => {
    const result = createOpenFile(node, '')
    expect(result.content).toBe('')
  })
})
