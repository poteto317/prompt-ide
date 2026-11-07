import { describe, expect, it } from 'vitest'
import { win32 } from 'node:path'
import {
  alignDirWithHome,
  isLexicallyInsideHome,
  resolveGlobalAgentInstructionLocations
} from '../globalAgentInstructionLocations'

const HOME = '/home/u'
const describePosix = describe.skipIf(process.platform === 'win32')
const resolveWith = (
  env: NodeJS.ProcessEnv
): ReturnType<typeof resolveGlobalAgentInstructionLocations> =>
  resolveGlobalAgentInstructionLocations({ env, homeDir: HOME })

describePosix('resolveGlobalAgentInstructionLocations', () => {
  it('環境変数が無い → ~/.claude/CLAUDE.md と ~/.copilot/copilot-instructions.md', () => {
    const locations = resolveWith({})
    expect(locations.claude).toMatchObject({
      kind: 'resolved',
      dirPath: '/home/u/.claude',
      filePath: '/home/u/.claude/CLAUDE.md',
      displayPath: '~/.claude/CLAUDE.md'
    })
    expect(locations.copilot).toMatchObject({
      kind: 'resolved',
      dirPath: '/home/u/.copilot',
      filePath: '/home/u/.copilot/copilot-instructions.md',
      displayPath: '~/.copilot/copilot-instructions.md'
    })
  })

  it('絶対パスの環境変数 → そのフォルダの下', () => {
    const locations = resolveWith({
      CLAUDE_CONFIG_DIR: '/home/u/work/cc',
      COPILOT_HOME: '/home/u/ch'
    })
    expect(locations.claude).toMatchObject({
      filePath: '/home/u/work/cc/CLAUDE.md',
      displayPath: '~/work/cc/CLAUDE.md'
    })
    expect(locations.copilot).toMatchObject({ filePath: '/home/u/ch/copilot-instructions.md' })
  })

  it('.. を含む絶対パス → 畳んでから決める', () => {
    expect(resolveWith({ CLAUDE_CONFIG_DIR: '/home/u/a/../cc' }).claude).toMatchObject({
      dirPath: '/home/u/cc'
    })
  })

  it.each([
    ['相対パス', 'rel'],
    ['空の文字列', '']
  ])('claude で %s → envNotAbsolute', (_label, value) => {
    expect(resolveWith({ CLAUDE_CONFIG_DIR: value }).claude).toMatchObject({
      kind: 'unavailable',
      reason: 'envNotAbsolute'
    })
  })

  it('copilot で空の文字列 → 既定の ~/.copilot', () => {
    expect(resolveWith({ COPILOT_HOME: '' }).copilot).toMatchObject({
      kind: 'resolved',
      dirPath: '/home/u/.copilot'
    })
  })

  it('copilot で相対パス → envNotAbsolute', () => {
    expect(resolveWith({ COPILOT_HOME: 'rel' }).copilot).toMatchObject({
      kind: 'unavailable',
      reason: 'envNotAbsolute'
    })
  })

  it.each([
    ['ホームの外', '/tmp/cc'],
    ['.. でホームの外', '/home/u/../other']
  ])('%s → envOutsideHome', (_label, value) => {
    expect(resolveWith({ CLAUDE_CONFIG_DIR: value }).claude).toMatchObject({
      kind: 'unavailable',
      reason: 'envOutsideHome'
    })
  })

  it('ホームそのもの → ~/CLAUDE.md', () => {
    expect(resolveWith({ CLAUDE_CONFIG_DIR: '/home/u' }).claude).toMatchObject({
      kind: 'resolved',
      dirPath: '/home/u',
      displayPath: '~/CLAUDE.md'
    })
  })

  it('.. で始まる名前のフォルダ(~/..x) → 中として扱う', () => {
    expect(resolveWith({ CLAUDE_CONFIG_DIR: '/home/u/..x' }).claude).toMatchObject({
      kind: 'resolved',
      displayPath: '~/..x/CLAUDE.md'
    })
  })
})

describePosix('isLexicallyInsideHome', () => {
  it.each([
    ['/home/u', true],
    ['/home/u/.claude', true],
    ['/home/u/..x', true],
    ['/home', false],
    ['/home/other', false],
    ['/tmp', false]
  ])('%s → %s', (path, expected) => {
    expect(isLexicallyInsideHome(HOME, path)).toBe(expected)
  })
})

describe('alignDirWithHome', () => {
  it('Windows でホームを大文字小文字違いで書いた → ホームの文字列に揃える', () => {
    expect(alignDirWithHome('C:\\Users\\x', 'c:\\users\\X', win32.relative)).toBe('C:\\Users\\x')
  })

  it('Windows でホームの下のフォルダ → そのまま', () => {
    expect(alignDirWithHome('C:\\Users\\x', 'c:\\users\\x\\.claude', win32.relative)).toBe(
      'c:\\users\\x\\.claude'
    )
  })

  it.skipIf(process.platform === 'win32')('ホームそのもの・下のフォルダ(既定の relative)', () => {
    expect(alignDirWithHome(HOME, HOME)).toBe(HOME)
    expect(alignDirWithHome(HOME, `${HOME}/.claude`)).toBe(`${HOME}/.claude`)
  })
})
