import { describe, it, expect } from 'vitest'
import { classifyAgentTerminalKey, isInsideAgentTerminal } from '../agentTerminalKeys'

const key = (
  init: Partial<KeyboardEvent> & { key: string }
): Parameters<typeof classifyAgentTerminalKey>[0] => ({
  type: 'keydown',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...init
})

describe('classifyAgentTerminalKey', () => {
  it.each<[string, Parameters<typeof classifyAgentTerminalKey>[0], boolean, boolean, string]>([
    ['F6 は抜ける', key({ key: 'F6' }), false, false, 'focus-out'],
    ['macOS でも F6 は抜ける', key({ key: 'F6' }), true, false, 'focus-out'],
    ['修飾キー付きの F6 は端末へ', key({ key: 'F6', shiftKey: true }), false, false, 'terminal'],
    [
      'Win・Linux の Ctrl+Shift+C(選択あり)はコピー',
      key({ key: 'C', ctrlKey: true, shiftKey: true }),
      false,
      true,
      'copy'
    ],
    [
      'Win・Linux の Ctrl+Shift+C(選択なし)は送らない',
      key({ key: 'C', ctrlKey: true, shiftKey: true }),
      false,
      false,
      'ignore'
    ],
    [
      'Win・Linux の Ctrl+Shift+V は貼り付け',
      key({ key: 'V', ctrlKey: true, shiftKey: true }),
      false,
      false,
      'paste'
    ],
    ['Ctrl+C は端末へ(claude の中断)', key({ key: 'c', ctrlKey: true }), false, true, 'terminal'],
    ['Ctrl+P は端末へ', key({ key: 'p', ctrlKey: true }), false, false, 'terminal'],
    [
      'macOS の Ctrl+Shift+C は端末へ(Cmd+C を使う)',
      key({ key: 'C', ctrlKey: true, shiftKey: true }),
      true,
      true,
      'terminal'
    ],
    ['keyup は端末へ', key({ key: 'F6', type: 'keyup' }), false, false, 'terminal']
  ])('%s', (_label, event, isMac, hasSelection, expected) => {
    expect(classifyAgentTerminalKey(event, isMac, hasSelection)).toBe(expected)
  })
})

describe('isInsideAgentTerminal', () => {
  it('data-agent-terminal の要素の中なら true', () => {
    const outer = document.createElement('div')
    outer.setAttribute('data-agent-terminal', '')
    const inner = document.createElement('textarea')
    outer.appendChild(inner)
    expect(isInsideAgentTerminal(inner)).toBe(true)
    expect(isInsideAgentTerminal(document.createElement('div'))).toBe(false)
    expect(isInsideAgentTerminal(null)).toBe(false)
    expect(isInsideAgentTerminal(window)).toBe(false)
  })
})
