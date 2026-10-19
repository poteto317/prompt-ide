import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import AgentTerminalPanel from '../AgentTerminalPanel'
import type { AgentTerminalPanelState } from '../../../hooks/useAgentWorkspace'
import {
  makeAgentSessionsState,
  makeAgentSessionTabView
} from '../../../__tests__/makeAgentSessionsState'
import {
  makeAgentInterruptPanelState,
  makeAgentTerminalPanelState
} from '../../../__tests__/makeAgentTerminalPanelState'
import { AGENT_START_DISABLED_NO_FOLDER } from '../../../lib/agentSessionMessages'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する(OutputPanel.styles.test.tsx と同じ流儀)。
// jsdom はレイアウトを計算しないため、狭い幅で帯が 1 行に収まるかそのものは測れない(実機の手動テストで確かめる。パターン 124)
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

beforeEach(() => {
  window.api.setAgentTerminalFocused = vi.fn()
})

// フォルダを開いていない状態(初回の起動で必ず通る)。帯に最も多くの部品が並ぶ
function renderNoFolder(): HTMLElement {
  const state: AgentTerminalPanelState = makeAgentTerminalPanelState({
    sessions: makeAgentSessionsState({ startDisabledReason: AGENT_START_DISABLED_NO_FOLDER }),
    resumeLast: { disabledReason: AGENT_START_DISABLED_NO_FOLDER, onResume: vi.fn() }
  })
  // 帯に最も多くの部品が並ぶよう、記録がある間の「変更を確認」も出す
  const { container } = render(
    <AgentTerminalPanel state={state} review={{ isRecording: true, onReview: vi.fn() }} />
  )
  return container
}

const styleOf = (container: HTMLElement, selector: string): CSSStyleDeclaration =>
  getComputedStyle(container.querySelector(selector) as HTMLElement)

describe('ターミナルパネルの見出しの帯のスタイル(main.css)', () => {
  it('帯は 32px のボタンが入る高さで、折り返さない', () => {
    const container = renderNoFolder()
    const header = styleOf(container, '.agent-terminal-panel__header')
    expect(header.minHeight).toBe('32px')
    expect(header.boxSizing).toBe('border-box')
    expect(header.flexWrap).not.toBe('wrap')
  })

  it('起動できない理由は 1 行で省略して縮み、全文は title に残す(狭い幅でボタンを押し出さない)', () => {
    const container = renderNoFolder()
    const reason = styleOf(container, '.agent-terminal-panel__reason')
    expect(reason.whiteSpace).toBe('nowrap')
    expect(reason.overflow).toBe('hidden')
    expect(reason.textOverflow).toBe('ellipsis')
    expect(reason.minWidth).toBe('0px')
    expect(reason.flexShrink).not.toBe('0')
    expect(container.querySelector('.agent-terminal-panel__reason')).toHaveAttribute(
      'title',
      AGENT_START_DISABLED_NO_FOLDER
    )

    // 操作群は箱を作らず(display: contents)、理由とボタンを帯の直接の子として並べる。
    // 縮められる箱の中に縮まないボタンを入れると、箱だけが縮んでボタンが帯の外へはみ出し、右端の最大化が切れていた
    const actions = styleOf(container, '.agent-terminal-panel__actions')
    expect(actions.display).toBe('contents')
  })

  it('状態の文言・タブ列より先に、起動できない理由が縮む', () => {
    const container = renderNoFolder()
    const reasonShrink = Number(styleOf(container, '.agent-terminal-panel__reason').flexShrink)
    const statusShrink = Number(styleOf(container, '.agent-terminal-panel__status').flexShrink)
    const tabsShrink = Number(styleOf(container, '.agent-session-tabs').flexShrink)
    expect(reasonShrink).toBeGreaterThan(statusShrink)
    expect(reasonShrink).toBeGreaterThan(tabsShrink)
  })

  it('前回の続きからのボタンは、理由の次に縮んで文字を省略する(最大化などの縮まないボタンを帯の外へ押し出さない)', () => {
    renderNoFolder()
    const resume = getComputedStyle(screen.getByRole('button', { name: /^前回の続きから/ }))
    expect(resume.whiteSpace).toBe('nowrap')
    expect(resume.overflow).toBe('hidden')
    expect(resume.textOverflow).toBe('ellipsis')
    // 枠が潰れて押せなくならないよう、最初の数文字と省略記号が入る幅は残す
    expect(resume.minWidth).toBe('4em')
    const container = document.body
    const resumeShrink = Number(resume.flexShrink)
    const reasonShrink = Number(styleOf(container, '.agent-terminal-panel__reason').flexShrink)
    const statusShrink = Number(styleOf(container, '.agent-terminal-panel__status').flexShrink)
    const tabsShrink = Number(styleOf(container, '.agent-session-tabs').flexShrink)
    expect(resumeShrink).toBeLessThan(reasonShrink)
    expect(resumeShrink).toBeGreaterThan(statusShrink)
    expect(resumeShrink).toBeGreaterThan(tabsShrink)
  })

  it('開閉・起動・変更を確認・最大化のボタンは縮まず、折り返さない', () => {
    renderNoFolder()
    const buttons = [
      screen.getByRole('button', { name: /^▾ エージェント$|^エージェント$/ }),
      screen.getByRole('button', { name: /^起動/ }),
      screen.getByRole('button', { name: 'エージェントの変更を確認（ソース管理を開く）' }),
      screen.getByRole('button', { name: '最大化' })
    ]
    for (const button of buttons) {
      const style = getComputedStyle(button)
      expect(style.flexShrink).toBe('0')
      expect(style.whiteSpace).toBe('nowrap')
    }
  })

  it('ボタンのフォーカスリングは帯の内側に描く(帯の overflow: hidden で切れない)', () => {
    // jsdom は :focus-visible を計算しないため、規則そのものを CSSOM から探す
    const rules = Array.from(styleElement.sheet?.cssRules ?? []).filter(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule
    )
    for (const selector of [
      '.agent-terminal-panel__toggle:focus-visible',
      '.agent-terminal-panel__button:focus-visible'
    ]) {
      const rule = rules.find((r) => r.selectorText.split(/,\s*/).includes(selector))
      expect(rule, selector).toBeDefined()
      expect(rule?.style.outlineOffset).toBe('-2px')
      // jsdom は outline の一括指定を個別の値に展開しない
      expect(rule?.style.getPropertyValue('outline')).toContain('solid')
    }
  })

  describe('中断のボタン', () => {
    // 実行中の帯(中断・終了・最大化)。disabledReason を渡すと押せない(aria-disabled)状態
    function renderRunning(disabledReason: string | null): HTMLElement {
      const state: AgentTerminalPanelState = makeAgentTerminalPanelState({
        sessions: makeAgentSessionsState({ selected: { status: 'running' } }),
        interrupt: makeAgentInterruptPanelState({ visible: true, disabledReason })
      })
      render(<AgentTerminalPanel state={state} />)
      return screen.getByRole('button', { name: /^中断/ })
    }
    const cssRules = (): CSSStyleRule[] =>
      Array.from(styleElement.sheet?.cssRules ?? []).filter(
        (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule
      )
    const indexOfRule = (selector: string): number =>
      cssRules().findIndex((rule) => rule.selectorText.split(/,\s*/).includes(selector))

    it('読み上げの要素(.agent-terminal-panel__live)は視覚的に隠す(読み上げには残す)', () => {
      renderRunning(null)
      const live = styleOf(document.body, '.agent-terminal-panel__live')
      expect(live.position).toBe('absolute')
      expect(live.width).toBe('1px')
      expect(live.overflow).toBe('hidden')
    })

    it('縮まず、折り返さない(共通のボタンの規則)', () => {
      const style = getComputedStyle(renderRunning(null))
      expect(style.flexShrink).toBe('0')
      expect(style.whiteSpace).toBe('nowrap')
      expect(style.minWidth).toBe('32px')
      expect(style.minHeight).toBe('32px')
    })

    it('押せない(aria-disabled)ときは :disabled と同じ見た目(不透明度 0.5・矢印のカーソル)', () => {
      const style = getComputedStyle(renderRunning('入力待ちのため、中断する作業がありません'))
      expect(style.opacity).toBe('0.5')
      expect(style.cursor).toBe('default')
    })

    it('押せるときは薄くしない', () => {
      expect(getComputedStyle(renderRunning(null)).opacity).not.toBe('0.5')
    })

    it('押せないときのホバーは色を変えない(既存のホバーの規則より後ろに置いて打ち消す)', () => {
      // jsdom は :hover を計算しないため、規則そのものを CSSOM から探す
      const disabledHover = indexOfRule(".agent-terminal-panel__button[aria-disabled='true']:hover")
      const hover = indexOfRule('.agent-terminal-panel__button:hover:not(:disabled)')
      expect(disabledHover).toBeGreaterThan(-1)
      expect(disabledHover).toBeGreaterThan(hover)
      const rule = cssRules()[disabledHover]
      expect(rule.style.cssText).toContain('background: none')
      expect(rule.style.getPropertyValue('color')).toBe('rgb(204, 204, 204)')
    })
  })

  describe('セッションのタブ列', () => {
    function renderTabs(): HTMLElement {
      const tabs = [
        makeAgentSessionTabView({ slotId: 'a', label: 'claude 1', status: 'running' }),
        makeAgentSessionTabView({ slotId: 'b', label: 'claude 2', status: 'starting' }),
        makeAgentSessionTabView({ slotId: 'c', label: 'claude 3', status: 'exited' })
      ]
      const state: AgentTerminalPanelState = makeAgentTerminalPanelState({
        sessions: makeAgentSessionsState({
          tabs,
          selected: tabs[0],
          addDisabledReason: '上限です'
        })
      })
      return render(<AgentTerminalPanel state={state} />).container
    }

    it('タブ列は横にはみ出したらスクロールし、縮められる', () => {
      const container = renderTabs()
      const list = styleOf(container, '.agent-session-tabs__list')
      expect(list.overflowX).toBe('auto')
      expect(list.minWidth).toBe('0px')
      const root = styleOf(container, '.agent-session-tabs')
      expect(root.minWidth).toBe('0px')
      expect(root.display).toBe('flex')
    })

    it('選択中のタブには下線があり、状態の印は状態ごとに色が違う', () => {
      const container = renderTabs()
      const selected = styleOf(container, '.agent-session-tabs__tab--selected')
      expect(selected.borderBottomColor).not.toBe('')
      expect(selected.borderBottomColor).not.toBe('transparent')
      // running のタブの印は活動の class(unknown など)が重なって塗りが変わるため、running の規則の宣言値で比べる
      const colorOf = (status: string): string =>
        status === 'running'
          ? runningColor()
          : styleOf(container, `.agent-session-tabs__dot--${status}`).backgroundColor
      expect(colorOf('running')).not.toBe(colorOf('starting'))
      expect(colorOf('starting')).not.toBe(colorOf('exited'))
      expect(colorOf('running')).not.toBe('')
    })

    // jsdom は animation を computed に出さないため、規則そのものを CSSOM から探す(複数のセレクタの規則も拾う)
    const findRules = (selector: string): CSSStyleRule[] =>
      Array.from(styleElement.sheet?.cssRules ?? [])
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
        .filter((rule) => rule.selectorText.split(/,\s*/).includes(selector))

    // running の印の色(running の規則の宣言値。描画したタブの印は活動の class が重なるため computed では取らない)
    const runningColor = (): string => declaredOf('running', 'background-color')

    // 印の色。working は中抜きの輪(塗りは透明で、内側の影が輪の色)なので、輪の色を印の色とみなす
    const declaredOf = (activity: string, property: string): string =>
      findRules(`.agent-session-tabs__dot--${activity}`)
        .map((rule) => rule.style.getPropertyValue(property))
        .find((value) => value !== '') ?? ''
    // box-shadow の色は宣言のまま(#rrggbb)残るため、塗りの色(rgb(...))と比べられるよう rgb に直す
    const ringColorOf = (activity: string): string => {
      const color = /rgb\([^)]*\)|#[0-9a-f]{6}/i.exec(declaredOf(activity, 'box-shadow'))?.[0] ?? ''
      if (!color.startsWith('#')) return color
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
      return `rgb(${r}, ${g}, ${b})`
    }

    it('活動ごとの印は、working・idle が緑、permission・confirm が同じ橙で、running の色と区別できる', () => {
      renderTabs()
      const colorOf = (activity: string): string => {
        const fill = declaredOf(activity, 'background-color')
        return fill === '' || fill === 'transparent' ? ringColorOf(activity) : fill
      }
      const running = runningColor()
      for (const activity of ['working', 'idle', 'permission', 'confirm']) {
        expect(colorOf(activity), activity).not.toBe('')
        expect(colorOf(activity), activity).not.toBe(running)
      }
      expect(colorOf('working')).toBe(colorOf('idle'))
      expect(colorOf('permission')).toBe(colorOf('confirm'))
      expect(colorOf('working')).not.toBe(colorOf('permission'))
    })

    it('working は中抜きの輪、idle は塗りの丸で、点滅が無くても(reduced-motion でも)形で見分けられる', () => {
      renderTabs()
      expect(declaredOf('working', 'background-color')).toBe('transparent')
      expect(declaredOf('working', 'box-shadow')).toContain('inset')
      expect(ringColorOf('working')).not.toBe('')
      expect(declaredOf('idle', 'background-color')).not.toBe('transparent')
      expect(declaredOf('idle', 'box-shadow')).toBe('')
      // reduced-motion の規則は点滅を止めるだけで、working の形(塗り・輪)を idle に戻さない
      const reducedRules = Array.from(styleElement.sheet?.cssRules ?? [])
        .filter(
          (rule): rule is CSSMediaRule =>
            rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion')
        )
        .flatMap((m) => Array.from(m.cssRules))
        .filter(
          (rule): rule is CSSStyleRule =>
            rule instanceof CSSStyleRule &&
            rule.selectorText.includes('agent-session-tabs__dot--working')
        )
      for (const rule of reducedRules) {
        expect(rule.style.backgroundColor).toBe('')
        expect(rule.style.boxShadow).toBe('')
      }
    })

    // 印の形。塗り(無し・単色・中心の点)と内側の輪の有無の組。色だけ(色覚の多様性)・動きだけ(reduced-motion)に頼らない
    const shapeOf = (activity: string): string => {
      const fill = declaredOf(activity, 'background-color')
      const image = declaredOf(activity, 'background-image')
      const fillKind = image.includes('radial-gradient')
        ? 'center-dot'
        : fill === '' || fill === 'transparent'
          ? 'none'
          : declaredOf(activity, 'border-radius') === '2px'
            ? 'solid-square'
            : 'solid'
      const ring = declaredOf(activity, 'box-shadow').includes('inset') ? 'ring' : 'no-ring'
      return `${fillKind}/${ring}`
    }

    it('unknown(実行中)は中心に点のある輪で、working(中抜きの輪)・idle(塗りの丸)・permission/confirm(橙の角の丸い四角)と形で見分けられる', () => {
      renderTabs()
      expect(shapeOf('unknown')).toBe('center-dot/ring')
      expect(shapeOf('working')).toBe('none/ring')
      expect(shapeOf('idle')).toBe('solid/no-ring')
      expect(shapeOf('permission')).toBe('solid-square/no-ring')
      expect(shapeOf('confirm')).toBe('solid-square/no-ring')
      const shapes = ['unknown', 'working', 'idle', 'permission'].map(shapeOf)
      expect(new Set(shapes).size).toBe(shapes.length)
      // unknown の色は running の色(青緑)のまま
      expect(ringColorOf('unknown')).toBe(runningColor())
    })

    it('点滅するのは working だけ(idle・permission・confirm は点滅しない)', () => {
      renderTabs()
      const animationOf = (activity: string): string =>
        findRules(`.agent-session-tabs__dot--${activity}`)
          .map((rule) => rule.style.animation)
          .find((value) => value !== '') ?? ''
      expect(animationOf('working')).toContain('infinite')
      for (const activity of ['idle', 'permission', 'confirm']) {
        expect(animationOf(activity), activity).toBe('')
      }
    })

    it('点滅は prefers-reduced-motion: reduce では止める', () => {
      const media = Array.from(styleElement.sheet?.cssRules ?? []).filter(
        (rule): rule is CSSMediaRule =>
          rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion')
      )
      const stops = media
        .flatMap((m) => Array.from(m.cssRules))
        .filter(
          (rule): rule is CSSStyleRule =>
            rule instanceof CSSStyleRule && rule.selectorText.includes('agent-session-tabs__dot')
        )
      expect(stops.length).toBeGreaterThan(0)
      expect(
        stops.some(
          (rule) =>
            rule.selectorText.includes('agent-session-tabs__dot--working') &&
            rule.style.animation === 'none'
        )
      ).toBe(true)
    })

    it('+ を押せない理由は視覚的に隠す(読み上げには残す)', () => {
      const container = renderTabs()
      const reason = styleOf(container, '.agent-session-tabs__reason')
      expect(reason.position).toBe('absolute')
      expect(reason.width).toBe('1px')
    })
  })
})

describe('ステータスバーのエージェントのまとめの hover(main.css)', () => {
  // jsdom は :hover を計算しないので、規則の宣言値を直接読む
  const hoverBackground = (selector: string): string | undefined =>
    Array.from(styleElement.sheet?.cssRules ?? [])
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
      .find((rule) =>
        rule.selectorText
          .split(',')
          .map((s) => s.trim())
          .includes(selector)
      )?.style.background

  it('強調なしの hover は背景を暗くする(明るくすると #007acc と白の文字の比が 4.5:1 を割る)', () => {
    expect(hoverBackground('.status-bar__agent:hover')).toBe('rgba(0, 0, 0, 0.15)')
  })

  it('強調ありの hover は橙を少し暗くする(#1e1e1e の文字との比が 4.5:1 以上)', () => {
    expect(hoverBackground('.status-bar__agent--attention:hover')).toBe('rgb(201, 119, 47)')
  })

  it('強調ありの hover は通常の hover と詳細度が同じなので、後ろに書いて勝たせる', () => {
    const selectors = Array.from(styleElement.sheet?.cssRules ?? [])
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
      .map((rule) => rule.selectorText)
    const normal = selectors.indexOf('.status-bar__agent:hover')
    const attention = selectors.indexOf('.status-bar__agent--attention:hover')
    expect(normal).toBeGreaterThanOrEqual(0)
    expect(attention).toBeGreaterThan(normal)
  })
})
