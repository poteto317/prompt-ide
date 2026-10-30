import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { GitLogRef } from '@shared/types'
import GitLogRefLabels from '../GitLogRefLabels'

const current: GitLogRef = { kind: 'current', name: 'main' }
const remote: GitLogRef = { kind: 'remote', name: 'origin/main' }
const tag: GitLogRef = { kind: 'tag', name: 'v1.0.0' }
const branch: GitLogRef = { kind: 'branch', name: 'feature/x' }

// 見た目に出る文字だけを取り出す(読み上げ用の隠しテキストは除く)
const labelNames = (container: HTMLElement): (string | null)[] =>
  Array.from(container.querySelectorAll('.history-section__ref')).map((el) => {
    const clone = el.cloneNode(true) as Element
    clone.querySelectorAll('.history-section__visually-hidden').forEach((hidden) => hidden.remove())
    return clone.textContent
  })

describe('GitLogRefLabels', () => {
  it('ref が無いときは何も描かない(空の列で件名の幅を奪わない)', () => {
    const { container } = render(<GitLogRefLabels refs={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('ref が 2 つまでなら全部出し、+N を出さない', () => {
    const { container } = render(<GitLogRefLabels refs={[current, remote]} />)
    expect(labelNames(container)).toEqual(['main', 'origin/main'])
  })

  it('3 つ以上は先頭 2 つと +N にまとめ、+N の title に残りの名前を入れる', () => {
    render(<GitLogRefLabels refs={[current, remote, tag, branch]} />)
    expect(screen.getByText('+2')).toHaveAttribute('title', 'v1.0.0\nfeature/x')
    expect(screen.queryByText('v1.0.0')).not.toBeInTheDocument()
    expect(screen.queryByText('feature/x')).not.toBeInTheDocument()
  })

  it('優先は現在のブランチ、リモート、タグ、ほかのローカルブランチの順(入力の順に依らない)', () => {
    const { container, rerender } = render(
      <GitLogRefLabels refs={[branch, tag, remote, current]} />
    )
    expect(labelNames(container)).toEqual(['main', 'origin/main', '+2'])
    rerender(<GitLogRefLabels refs={[branch, tag]} />)
    expect(labelNames(container)).toEqual(['v1.0.0', 'feature/x'])
  })

  it('同じ種類の ref は入力の順を保つ', () => {
    const second: GitLogRef = { kind: 'tag', name: 'v0.9.0' }
    const { container } = render(<GitLogRefLabels refs={[tag, second]} />)
    expect(labelNames(container)).toEqual(['v1.0.0', 'v0.9.0'])
  })

  it('各ラベルの title に全文を入れる(省略記号で切り詰められても読める)', () => {
    render(<GitLogRefLabels refs={[{ kind: 'remote', name: 'origin/very/long/branch' }]} />)
    expect(screen.getByText('origin/very/long/branch').closest('[title]')).toHaveAttribute(
      'title',
      'origin/very/long/branch'
    )
  })

  it.each<[GitLogRef, string]>([
    [current, '現在のブランチ main'],
    [remote, 'リモート origin/main'],
    [tag, 'タグ v1.0.0'],
    [branch, 'ブランチ feature/x']
  ])('色とアイコンで示す種類を、名前の前の隠しテキストでも伝える(%j)', (ref, expected) => {
    const { container } = render(<GitLogRefLabels refs={[ref]} />)
    const label = container.querySelector('.history-section__ref') as Element
    expect(label.textContent).toBe(expected)
    expect(label.firstElementChild?.nextElementSibling).toHaveClass(
      'history-section__visually-hidden'
    )
  })

  // タグのバッジを無くしたため、+N の中のタグ名は title だけだとスクリーンリーダーで読めない
  it('+N の残りの名前を、種類と一緒に隠しテキストでも伝える', () => {
    render(<GitLogRefLabels refs={[current, remote, tag, branch]} />)
    const hidden = screen.getByText('タグ v1.0.0、ブランチ feature/x')
    expect(hidden).toHaveClass('history-section__visually-hidden')
    expect(hidden.closest('.history-section__ref--more')).toHaveTextContent(/^\+2/)
  })

  it('+N が無いときは、+N のための隠しテキストを出さない', () => {
    const { container } = render(<GitLogRefLabels refs={[current, remote]} />)
    expect(container.querySelector('.history-section__ref--more')).toBeNull()
    expect(container.querySelectorAll('.history-section__visually-hidden')).toHaveLength(2)
  })

  it('ラベルが 2 つ以上の行だけ、列に縮まない印を付ける(1 つなら名前を切り詰めてグラフへ幅を譲る)', () => {
    const { container, rerender } = render(<GitLogRefLabels refs={[current]} />)
    const column = (): Element => container.querySelector('.history-section__refs') as Element
    expect(column()).not.toHaveClass('history-section__refs--multiple')
    rerender(<GitLogRefLabels refs={[current, remote]} />)
    expect(column()).toHaveClass('history-section__refs--multiple')
  })

  it('種類ごとのクラスとアイコンを付ける(ブランチ・リモート・タグでアイコンが違う)', () => {
    const { container } = render(<GitLogRefLabels refs={[current, remote]} />)
    const { container: other } = render(<GitLogRefLabels refs={[tag, branch]} />)
    const pick = (root: HTMLElement, modifier: string): Element =>
      root.querySelector(`.history-section__ref--${modifier}`) as Element
    const iconOf = (el: Element): string | null | undefined =>
      el.querySelector('svg path')?.getAttribute('d')

    const icons = [
      iconOf(pick(container, 'current')),
      iconOf(pick(container, 'remote')),
      iconOf(pick(other, 'tag'))
    ]
    expect(icons.every(Boolean)).toBe(true)
    expect(new Set(icons).size).toBe(3)
    expect(iconOf(pick(other, 'branch'))).toBe(iconOf(pick(container, 'current')))
  })
})
