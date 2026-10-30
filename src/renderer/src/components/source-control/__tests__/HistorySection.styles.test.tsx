import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type { GitLogRef } from '@shared/types'
import HistorySection from '../HistorySection'
import { makeGitTagPanelState } from '../../../__tests__/makeGitTagPanelState'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// 「タグを作成」と種類の選択肢は、退避・マージのバナーのボタンと 1 つのグループセレクタで宣言を共有する
// (パターン 30・77)。グループから外れると見た目が崩れるため固定する。jsdom は :hover を計算しない
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const renderSection = (
  isCreating = false,
  tags: string[] = []
): ((isCreating: boolean) => void) => {
  const build = (creating: boolean): React.JSX.Element => (
    <HistorySection
      log={[]}
      upstream={null}
      branches={[]}
      tags={tags}
      hasMore={false}
      isLoading={false}
      error={null}
      onLoadMore={vi.fn()}
      gitTag={makeGitTagPanelState({ isCreating: creating })}
      isBlocked={false}
    />
  )
  const { rerender } = render(build(isCreating))
  return (creating) => rerender(build(creating))
}

describe('HistorySection のスタイル(main.css)', () => {
  it('見出し行は見出しとボタンを横に並べる', () => {
    renderSection()
    const header = screen.getByRole('heading', { name: '履歴' }).parentElement as HTMLElement
    const style = getComputedStyle(header)
    expect(style.display).toBe('flex')
    expect(style.justifyContent).toBe('space-between')
  })

  it('「タグを作成」は 32px 四方以上の枠付きボタンになる', () => {
    renderSection()
    const style = getComputedStyle(screen.getByRole('button', { name: 'タグを作成' }))
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
    expect(style.borderTopStyle).toBe('solid')
  })

  it('種類の選択肢は 32px 四方以上で、作成ボタンは disabled のとき半透明になる', async () => {
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    const kindStyle = getComputedStyle(screen.getByRole('radio', { name: '軽量' }))
    expect(kindStyle.minWidth).toBe('32px')
    expect(kindStyle.minHeight).toBe('32px')
    expect(getComputedStyle(screen.getByRole('button', { name: '作成' })).opacity).toBe('0.5')
  })

  it('作成中のキャンセルは disabled になり、押せるように見えない(半透明・既定のカーソル)', async () => {
    const setCreating = renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    setCreating(true)
    const style = getComputedStyle(screen.getByRole('button', { name: 'キャンセル' }))
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('default')
  })

  it('選択中の種類だけ強調色になる(aria-checked の状態を見た目にも出す)', async () => {
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    const checked = getComputedStyle(screen.getByRole('radio', { name: '軽量' }))
    const unchecked = getComputedStyle(screen.getByRole('radio', { name: '注釈付き' }))
    expect(checked.backgroundColor).toBe('rgb(9, 71, 113)')
    expect(checked.borderTopColor).toBe('rgb(0, 122, 204)')
    expect(unchecked.borderTopColor).toBe('rgb(85, 85, 85)')
  })

  it('検証エラーの文は、長い既存のタグ名を含んでも枠内で折り返す(overflow-wrap)', async () => {
    const longTag = 'release/2024.01.15_hotfix_for_customer_contoso_emergency_patch_v2'
    renderSection(false, [longTag])
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    // 既存タグの子になる名前は「既存のタグ <名前> と名前が衝突します」となり、長い名前がエラー文に入る
    await userEvent.type(screen.getByRole('textbox', { name: 'タグ名' }), `${longTag}/x`)
    const error = document.querySelector('.name-input-dialog__error') as HTMLElement
    expect(error.textContent).toContain(longTag)
    expect(getComputedStyle(error).overflowWrap).toBe('anywhere')
  })

  it('ダイアログの説明文と各欄のラベルは同じ小さい文字・色になる(1 つのグループセレクタで共有する)', async () => {
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    const note = getComputedStyle(screen.getByText('現在の HEAD にタグを付けます'))
    const label = getComputedStyle(screen.getByText('タグ名'))
    expect(note.fontSize).toBe('11px')
    expect(note.color).toBe('rgb(150, 150, 150)')
    expect(label.fontSize).toBe(note.fontSize)
    expect(label.color).toBe(note.color)
    expect(note.marginBottom).toBe('4px')
    expect(label.marginBottom).not.toBe('4px')
  })
})

describe('履歴の行のスタイル(main.css)', () => {
  const renderRow = (refs: GitLogRef[] = []): HTMLElement => {
    render(
      <HistorySection
        log={[
          {
            hash: 'a'.repeat(40),
            parents: [],
            refs,
            isHead: false,
            message: 'feat: 新機能',
            date: '2026-09-03T10:00:00+09:00',
            authorName: 'Alice'
          }
        ]}
        upstream={null}
        branches={[]}
        tags={[]}
        hasMore={false}
        isLoading={false}
        error={null}
        onLoadMore={vi.fn()}
        gitTag={makeGitTagPanelState()}
        isBlocked={false}
      />
    )
    return screen.getByRole('listitem')
  }

  const expectEllipsis = (el: Element): void => {
    const style = getComputedStyle(el)
    expect(style.overflow).toBe('hidden')
    expect(style.textOverflow).toBe('ellipsis')
    expect(style.whiteSpace).toBe('nowrap')
    expect(style.minWidth).toBe('0px')
  }

  const channel = (value: number): number => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  const luminance = (color: string): number => {
    const [r, g, b] = (color.match(/\d+/g) ?? []).map(Number)
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }
  const contrast = (a: string, b: string): number => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (light + 0.05) / (dark + 0.05)
  }

  it('行は高さ 22px の横並びで、縦の余白と下線が無い(線が行の境目でつながる)', () => {
    const style = getComputedStyle(renderRow())
    expect(style.display).toBe('flex')
    expect(style.alignItems).toBe('center')
    expect(style.height).toBe('22px')
    expect(style.paddingTop).toBe('0px')
    expect(style.paddingBottom).toBe('0px')
    expect(style.borderBottomStyle).toBe('none')
  })

  it('グラフの幅の上限は行の 50% で、超えた分を切る', () => {
    const graph = getComputedStyle(renderRow().querySelector('.history-section__graph') as Element)
    expect(graph.flexGrow).toBe('0')
    expect(graph.maxWidth).toBe('50%')
    expect(graph.overflow).toBe('hidden')
    expect(graph.display).toBe('block')
  })

  // 上限どうしの合計は 95% で、件名の欄が 5% まで潰れる。件名の欄に最低の幅を持たせ、足りない分はグラフとラベルを縮める。
  // 基準の幅が 0 なので、長い件名に押されてレーンの少ない行のグラフが比例して縮むことも無い
  it('グラフとラベルが上限まで広がっても、件名の欄は行の 40% を保つ', () => {
    const row = renderRow([{ kind: 'current', name: 'main' }])
    const text = row.querySelector('.history-section__log-text') as Element
    const textStyle = getComputedStyle(text)
    expect(textStyle.flexGrow).toBe('1')
    expect(textStyle.flexBasis).toBe('0%')
    expect(textStyle.minWidth).toBe('40%')
    const graph = getComputedStyle(row.querySelector('.history-section__graph') as Element)
    expect(graph.flexShrink).toBe('1')
    expect(graph.minWidth).toBe('0px')
  })

  it('件名は省略記号で切り詰め、作成者は薄い色で省略記号で切り詰める', () => {
    const row = renderRow()
    const message = screen.getByText('feat: 新機能')
    const author = screen.getByText('Alice')
    expect(row).toContainElement(message)
    expectEllipsis(message)
    expectEllipsis(author)
    expect(getComputedStyle(author).color).toBe('rgb(150, 150, 150)')
    // 長い件名と比例して縮むと、作成者が 1 文字も読めなくなる
    expect(getComputedStyle(author).flexShrink).toBe('0')
    expect(getComputedStyle(author).maxWidth).toBe('30%')
  })

  it('ラベルの列は右端に寄り、幅の上限は行の 45% で、はみ出した分を切る(パネルが横にスクロールしない)', () => {
    const row = renderRow([{ kind: 'current', name: 'main' }])
    const labels = row.querySelector('.history-section__refs') as Element
    const style = getComputedStyle(labels)
    expect(style.marginLeft).toBe('auto')
    expect(style.maxWidth).toBe('45%')
    expect(style.overflow).toBe('hidden')
    expect(style.flexShrink).toBe('1')
    // ラベルが 1 つの列も、先頭のラベルの最低の幅より細くしない(レーンの多い行で現在のブランチが読めなくなる)
    expect(style.minWidth).toBe('40px')
  })

  // 列が縮むと、ラベルの最小幅の合計を下回って +N が切れる。レーンの多い行ほど列は細くなるため、縮めずに 45% まで取る
  it('ラベルが 2 つ以上の列は縮まない(足りない幅はグラフが譲る)', () => {
    const row = renderRow([
      { kind: 'current', name: 'main' },
      { kind: 'remote', name: 'origin/main' }
    ])
    const style = getComputedStyle(row.querySelector('.history-section__refs') as Element)
    expect(style.flexShrink).toBe('0')
    expect(style.maxWidth).toBe('45%')
    expect(style.overflow).toBe('hidden')
  })

  // flex コンテナ自身に text-overflow を指定しても、中の文字は省略記号にならない。文字の要素に指定する
  it('ラベルは列の幅に合わせて縮み、名前を省略記号で切り詰め、アイコンと +N は縮まない', () => {
    const row = renderRow([
      { kind: 'current', name: 'main' },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'tag', name: 'v1' }
    ])
    // 2 つ目から先に縮める。幅に比例して縮むと main まで「m…」に潰れる。先頭が長くても 2 つ目は消えない
    const first = row.querySelector('.history-section__ref--current') as Element
    expect(getComputedStyle(first).flexShrink).toBe('1')
    expect(getComputedStyle(first).minWidth).toBe('40px')
    const label = row.querySelector('.history-section__ref--remote') as Element
    expect(getComputedStyle(label).flexShrink).toBe('1000')
    // 余白 4px ずつとアイコン 12px。ここまで縮むとアイコンだけが残る
    expect(getComputedStyle(label).minWidth).toBe('20px')
    expectEllipsis(screen.getByText('origin/main'))
    expect(getComputedStyle(label.querySelector('svg') as Element).flexShrink).toBe('0')
    expect(getComputedStyle(screen.getByText('+1')).flexShrink).toBe('0')
  })

  // content-box だと余白の分だけ最小幅が増え、overflow が無いと縮んだラベルの中身がはみ出す
  it('ラベルの最小幅は余白を含み、縮んだ中身はラベルの中で切る', () => {
    const row = renderRow([
      { kind: 'current', name: 'main' },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'tag', name: 'v1' }
    ])
    row.querySelectorAll('.history-section__ref').forEach((label) => {
      const style = getComputedStyle(label)
      expect(style.boxSizing).toBe('border-box')
      expect(style.overflow).toBe('hidden')
    })
  })

  it('読み上げ用のテキストは .agent-changes__live と同じ規則で視覚的に隠す', () => {
    const row = renderRow([{ kind: 'current', name: 'main' }])
    const live = document.createElement('p')
    live.className = 'agent-changes__live'
    row.appendChild(live)
    const expected = getComputedStyle(live)
    const hiddenTexts = row.querySelectorAll('.history-section__visually-hidden')
    expect(hiddenTexts).toHaveLength(2)
    hiddenTexts.forEach((hidden) => {
      const style = getComputedStyle(hidden)
      expect(style.position).toBe('absolute')
      for (const name of ['width', 'height', 'margin', 'overflow', 'clip', 'whiteSpace'] as const) {
        expect(style[name]).toBe(expected[name])
      }
    })
    live.remove()
  })

  // 位置の基準が無いと、隠しテキストはスクロールの外の祖先を基準に置かれ、パネルのスクロールで切られずに残る
  it('行は隠しテキストの位置の基準になる', () => {
    expect(getComputedStyle(renderRow()).position).toBe('relative')
  })

  it.each<[GitLogRef['kind'], string]>([
    ['current', 'rgb(89, 164, 249)'],
    ['remote', 'rgb(177, 128, 215)'],
    ['branch', 'rgb(60, 60, 60)'],
    ['tag', 'rgb(60, 60, 60)']
  ])(
    '%s のラベルの配色は背景が指定の色で、文字とのコントラスト比が 4.5:1 以上',
    (kind, background) => {
      const row = renderRow([{ kind, name: 'x' }])
      const style = getComputedStyle(row.querySelector('.history-section__ref') as Element)
      expect(style.backgroundColor).toBe(background)
      expect(contrast(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5)
    }
  )

  it('作成者の文字色は、パネルの背景とのコントラスト比が 4.5:1 以上', () => {
    const author = getComputedStyle(
      renderRow().querySelector('.history-section__log-author') as Element
    )
    expect(contrast(author.color, 'rgb(37, 37, 38)')).toBeGreaterThanOrEqual(4.5)
  })

  it('削除したバッジ・ハッシュ・日時のスタイルが main.css に残っていない', () => {
    const css = styleElement.textContent ?? ''
    expect(css).not.toMatch(/\.history-section__(badge|log-hash|log-date)/)
  })
})
