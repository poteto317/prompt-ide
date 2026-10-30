import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import AgentChangesFileItem from '../AgentChangesFileItem'
import ChangesSection from '../ChangesSection'
import StagedSection from '../StagedSection'
import { makeAgentChangeEntry } from '../../../__tests__/makeAgentChangesState'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// jsdom は :hover と @media を計算しないため、それらは CSS の本文で固定する
let css: string
let styleElement: HTMLStyleElement

beforeAll(() => {
  css = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  styleElement = document.createElement('style')
  styleElement.textContent = css
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const renderChanged = (file: GitFileStatus): HTMLElement => {
  const { container } = render(
    <ChangesSection
      files={[file]}
      stagingPaths={new Set()}
      onStage={vi.fn()}
      onDiscard={vi.fn()}
      onOpenDiff={vi.fn()}
    />
  )
  return container.querySelector('li') as HTMLElement
}

const renderStaged = (file: GitFileStatus): HTMLElement => {
  const { container } = render(
    <StagedSection
      files={[file]}
      stagingPaths={new Set()}
      onUnstage={vi.fn()}
      onOpenDiff={vi.fn()}
    />
  )
  return container.querySelector('li') as HTMLElement
}

const openButton = (row: HTMLElement): HTMLElement => row.querySelector('button') as HTMLElement
const actions = (row: HTMLElement): HTMLElement =>
  row.querySelector('.source-control-panel__file-actions') as HTMLElement
const statusLetter = (row: HTMLElement): HTMLElement => row.lastElementChild as HTMLElement

/** セレクタを含む規則の本文(@media の外も中も)を返す */
const ruleBody = (source: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}[^{}]*\\{([^}]*)\\}`).exec(source)
  return match?.[1] ?? ''
}

const channel = (value: number): number => {
  const normalized = value / 255
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string): number => {
  const [r, g, b] = (hex.match(/[0-9a-f]{2}/gi) ?? []).map((part) => parseInt(part, 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}
const toHex = (rgb: string): string =>
  `#${(rgb.match(/\d+/g) ?? [])
    .slice(0, 3)
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('')}`

describe('ファイルの行のスタイル(main.css)', () => {
  it('行は高さ 22px の横並びで、::after の位置の基準になる', () => {
    const row = getComputedStyle(renderChanged({ path: 'a.ts', index: ' ', workingDir: 'M' }))
    expect(row.display).toBe('flex')
    expect(row.alignItems).toBe('center')
    expect(row.height).toBe('22px')
    expect(row.position).toBe('relative')
  })

  // button に position や overflow を付けると ::after が button の内側に閉じ込められ、行の全体を押せなくなる
  it('差分を開くボタンは ::after を行いっぱいに広げる(ボタン自身は位置の基準にならず、切り取らない)', () => {
    const row = renderChanged({ path: 'src/a.ts', index: ' ', workingDir: 'M' })
    const button = getComputedStyle(openButton(row))
    expect(button.position).toBe('static')
    expect(button.overflow).not.toBe('hidden')
    expect(button.flexGrow).toBe('1')
    expect(button.minWidth).toBe('0px')
    const after = ruleBody(css, '.source-control-panel__file-open::after')
    expect(after).toMatch(/position:\s*absolute/)
    expect(after).toMatch(/inset:\s*0/)
    expect(after).toMatch(/content:\s*''/)
  })

  it('省略記号は内側の span に付け、フォルダは薄い色にする', () => {
    const row = renderChanged({ path: 'src/a.ts', index: ' ', workingDir: 'M' })
    const label = getComputedStyle(screen.getByText('a.ts').parentElement as HTMLElement)
    expect(label.overflow).toBe('hidden')
    expect(label.textOverflow).toBe('ellipsis')
    expect(label.whiteSpace).toBe('nowrap')
    expect(row).toContainElement(screen.getByText('src'))
    expect(
      contrast(toHex(getComputedStyle(screen.getByText('src')).color), '#252526')
    ).toBeGreaterThanOrEqual(4.5)
    expect(getComputedStyle(screen.getByText('src')).color).not.toBe(
      getComputedStyle(screen.getByText('a.ts')).color
    )
  })

  it('操作の枠は ::after より上に置き、縮まない', () => {
    const style = getComputedStyle(
      actions(renderChanged({ path: 'a.ts', index: ' ', workingDir: 'M' }))
    )
    expect(style.position).toBe('relative')
    expect(style.zIndex).toBe('1')
    expect(style.flexShrink).toBe('0')
  })

  it('操作のボタンは display ではなく opacity で隠す(Tab の順を変えない)', () => {
    const row = renderChanged({ path: 'a.ts', index: ' ', workingDir: 'M' })
    expect(getComputedStyle(actions(row)).opacity).toBe('0')
    expect(getComputedStyle(screen.getByLabelText('a.ts をステージ')).display).not.toBe('none')
    expect(getComputedStyle(screen.getByLabelText('a.ts の変更を取り消し')).display).not.toBe(
      'none'
    )
  })

  it('ステージされている変更の行も同じ枠で隠す', () => {
    const row = renderStaged({ path: 'a.ts', index: 'M', workingDir: ' ' })
    expect(actions(row)).toContainElement(screen.getByLabelText('a.ts をアンステージ'))
    expect(getComputedStyle(actions(row)).opacity).toBe('0')
    expect(getComputedStyle(screen.getByLabelText('a.ts をアンステージ')).display).not.toBe('none')
  })

  it('行の hover と :focus-within で操作が見える', () => {
    const hoverSource = css.replace(/\s+/g, ' ')
    expect(hoverSource).toMatch(
      /\.source-control-panel__file-item:hover \.source-control-panel__file-actions,\s*\.source-control-panel__file-item:focus-within \.source-control-panel__file-actions \{\s*opacity: 1;/
    )
  })

  it('hover の無い環境では操作が常に見える', () => {
    const block = /@media \(hover: none\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(ruleBody(block, '.source-control-panel__file-actions')).toMatch(/opacity:\s*1/)
  })

  it('キーボードの枠は行の全体に出す', () => {
    expect(ruleBody(css, '.source-control-panel__file-open:focus-visible::after')).toMatch(
      /outline:\s*1px solid/
    )
  })

  it('ファイルの行の表示で使わなくなったスタイルが残っていない', () => {
    expect(css).not.toMatch(/\.source-control-panel__file-status--staged/)
    expect(css).not.toMatch(/\.source-control-panel__empty/)
  })
})

describe('状態の文字の色(main.css)', () => {
  const PANEL_BACKGROUND = '#252526'
  let hoverBackground: string

  beforeEach(() => {
    hoverBackground = /background:\s*(#[0-9a-f]{6})/i.exec(
      ruleBody(css, '.source-control-panel__file-item:hover')
    )?.[1] as string
  })

  it.each<[string, GitFileStatus, string]>([
    ['変更', { path: 'a', index: ' ', workingDir: 'M' }, 'rgb(226, 192, 141)'],
    ['リネーム', { path: 'a', index: ' ', workingDir: 'R' }, 'rgb(226, 192, 141)'],
    ['コピー', { path: 'a', index: ' ', workingDir: 'C' }, 'rgb(226, 192, 141)'],
    ['種類の変更', { path: 'a', index: ' ', workingDir: 'T' }, 'rgb(226, 192, 141)'],
    ['追加', { path: 'a', index: ' ', workingDir: 'A' }, 'rgb(115, 201, 145)'],
    ['未追跡', { path: 'a', index: '?', workingDir: '?' }, 'rgb(115, 201, 145)'],
    ['削除', { path: 'a', index: ' ', workingDir: 'D' }, 'rgb(244, 135, 113)'],
    ['その他', { path: 'a', index: ' ', workingDir: 'X' }, 'rgb(204, 204, 204)'],
    ['コンフリクト UU', { path: 'a', index: 'U', workingDir: 'U' }, 'rgb(244, 135, 113)'],
    ['コンフリクト AA', { path: 'a', index: 'A', workingDir: 'A' }, 'rgb(244, 135, 113)'],
    ['コンフリクト DD', { path: 'a', index: 'D', workingDir: 'D' }, 'rgb(244, 135, 113)']
  ])('%s の文字色が指定の色で、背景と hover の背景で 4.5:1 以上', (_label, file, color) => {
    const style = getComputedStyle(statusLetter(renderChanged(file)))
    expect(style.color).toBe(color)
    expect(contrast(toHex(style.color), PANEL_BACKGROUND)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(toHex(style.color), hoverBackground)).toBeGreaterThanOrEqual(4.5)
  })

  it('hover の背景は #2a2d2e のまま(コントラストの計算の前提)', () => {
    expect(hoverBackground).toBe('#2a2d2e')
  })

  it('ステージされている変更の行も同じ色の規則で出す', () => {
    const style = getComputedStyle(
      statusLetter(renderStaged({ path: 'a', index: 'A', workingDir: ' ' }))
    )
    expect(style.color).toBe('rgb(115, 201, 145)')
  })

  it('状態の文字は 2 つのセクションで同じ形になる', () => {
    const changed = statusLetter(renderChanged({ path: 'a', index: ' ', workingDir: 'M' }))
    const staged = statusLetter(renderStaged({ path: 'b', index: 'M', workingDir: ' ' }))
    expect(staged.className).toBe(changed.className)
  })
})

describe('エージェントの行へ波及しない(main.css)', () => {
  it('エージェントの行は既存のクラスと色のまま', () => {
    render(
      <ul>
        <AgentChangesFileItem
          entry={makeAgentChangeEntry('src/a.txt')}
          savedInApp={false}
          disabledReason={null}
          disabledReasonId="reason"
          onOpenDiff={vi.fn()}
          onRevert={vi.fn()}
        />
      </ul>
    )
    const path = screen.getByRole('button', { name: 'src/a.txt のエージェントの変更を表示' })
    expect(path).toHaveClass('source-control-panel__file-path')
    expect(path).toHaveTextContent('src/a.txt')
    expect(getComputedStyle(path).textOverflow).toBe('ellipsis')
    const status = path.previousElementSibling as HTMLElement
    expect(status).toHaveClass('source-control-panel__file-status--changed')
    expect(getComputedStyle(status).color).toBe('rgb(226, 192, 141)')
    expect(getComputedStyle(status).width).toBe('14px')
  })
})
