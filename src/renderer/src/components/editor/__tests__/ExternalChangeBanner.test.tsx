import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ExternalChangeBanner, { ExternalChangeAnnouncer } from '../ExternalChangeBanner'

// 通知の文言のライブリージョン(role="status" と同じ aria-live="polite"・aria-atomic。role は付けない:
// エディタの領域には出力パネルの常設の role="status" があり、同じ role を常設すると重なるため)
function liveRegion(): HTMLElement {
  const regions = document.querySelectorAll<HTMLElement>('[aria-live="polite"]')
  expect(regions).toHaveLength(1)
  expect(regions[0]).toHaveAttribute('aria-atomic', 'true')
  return regions[0]
}

describe('ExternalChangeBanner(見た目の帯)', () => {
  it('変更の通知の文言と、読み込む・このまま編集するのボタンを出す', async () => {
    const reload = vi.fn()
    const dismiss = vi.fn()
    render(<ExternalChangeBanner banner={{ path: '/p/a.ts', kind: 'modified', reload, dismiss }} />)
    expect(
      screen.getByText('ディスク上のファイルが変更されました（エージェントなどによる変更）。')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'ディスクの内容を読み込む' }))
    await userEvent.click(screen.getByRole('button', { name: 'このまま編集する' }))
    expect(reload).toHaveBeenCalledOnce()
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('削除の通知では読み込むのボタンを出さない', () => {
    render(
      <ExternalChangeBanner
        banner={{ path: '/p/a.ts', kind: 'deleted', reload: null, dismiss: vi.fn() }}
      />
    )
    expect(screen.getByText('ディスク上のファイルが削除されました。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ディスクの内容を読み込む' })).toBeNull()
  })

  it('帯はライブリージョンを持たず(読み上げは ExternalChangeAnnouncer が行う)、通知が無ければ何も出さない', () => {
    const { container, rerender } = render(
      <ExternalChangeBanner
        banner={{ path: '/p/a.ts', kind: 'modified', reload: vi.fn(), dismiss: vi.fn() }}
      />
    )
    expect(container.querySelector('[aria-live]')).toBeNull()
    // 同じ文言は読み上げの要素が伝えるため、帯の文言は支援技術から隠す(二重に読まれない)
    expect(
      screen.getByText('ディスク上のファイルが変更されました（エージェントなどによる変更）。')
    ).toHaveAttribute('aria-hidden', 'true')
    rerender(<ExternalChangeBanner banner={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ExternalChangeAnnouncer(読み上げ)', () => {
  // ライブリージョンは、文言ごと挿入されると読み上げられないことがある(パターン 87・123)。
  // ライブリージョンの要素を通知が無い間も空のまま置き、同じ要素に文言を入れる
  it('通知が無い間も空のライブリージョンを置き、通知が出たら同じ要素に文言を入れる(ボタンは含めない)', () => {
    const { rerender } = render(<ExternalChangeAnnouncer banner={null} />)
    const status = liveRegion()
    expect(status).toBeEmptyDOMElement()
    rerender(
      <ExternalChangeAnnouncer
        banner={{ path: '/p/a.ts', kind: 'modified', reload: vi.fn(), dismiss: vi.fn() }}
      />
    )
    expect(liveRegion()).toBe(status)
    expect(status).toHaveTextContent(
      'ディスク上のファイルが変更されました（エージェントなどによる変更）。'
    )
    expect(status.querySelector('button')).toBeNull()
    rerender(
      <ExternalChangeAnnouncer
        banner={{ path: '/p/a.ts', kind: 'deleted', reload: null, dismiss: vi.fn() }}
      />
    )
    expect(liveRegion()).toBe(status)
    expect(status).toHaveTextContent('ディスク上のファイルが削除されました。')
    rerender(<ExternalChangeAnnouncer banner={null} />)
    expect(liveRegion()).toBe(status)
    expect(status).toBeEmptyDOMElement()
  })
})
