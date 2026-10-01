import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { MergeStatePanelState } from '../../../types'
import MergeBanner from '../MergeBanner'
import { buildMergeBannerText } from '../../../lib/mergeStateMessage'

// 文言は buildMergeBannerText と共有する(直書きで二重管理しない)。呼び出しを確かめるため、
// 実装はそのまま使い、呼び出しだけ記録する
vi.mock('../../../lib/mergeStateMessage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/mergeStateMessage')>()
  return { ...actual, buildMergeBannerText: vi.fn(actual.buildMergeBannerText) }
})

const makeMergeState = (overrides: Partial<MergeStatePanelState> = {}): MergeStatePanelState => ({
  inProgress: true,
  unresolvedCount: 2,
  pendingOperation: null,
  error: null,
  canComplete: false,
  onComplete: vi.fn().mockResolvedValue(undefined),
  onAbort: vi.fn().mockResolvedValue(undefined),
  ...overrides
})

describe('MergeBanner', () => {
  it.each([0, 1, 3])(
    '未解決 %i 件のバナーの文言は buildMergeBannerText と一致する(共有して直書きしない)',
    (n) => {
      vi.mocked(buildMergeBannerText).mockClear()
      render(<MergeBanner isBlocked={false} mergeState={makeMergeState({ unresolvedCount: n })} />)
      expect(buildMergeBannerText).toHaveBeenCalledWith(n)
      expect(screen.getByRole('status').textContent).toBe(buildMergeBannerText(n))
    }
  )

  it('マージ中でなければ何も描画しない', () => {
    const { container } = render(
      <MergeBanner isBlocked={false} mergeState={makeMergeState({ inProgress: false })} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('未解決の件数を role="status" で出す', () => {
    render(<MergeBanner isBlocked={false} mergeState={makeMergeState({ unresolvedCount: 3 })} />)
    expect(screen.getByRole('status')).toHaveTextContent('マージ中（未解決 3 件）')
  })

  it('未解決が 0 件のときは完了できる旨の文言を出す', () => {
    render(
      <MergeBanner
        isBlocked={false}
        mergeState={makeMergeState({ unresolvedCount: 0, canComplete: true })}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'マージ中（すべて解決済み。マージを完了できます）'
    )
  })

  it('canComplete が偽なら「マージを完了」は disabled、「マージを中止」は有効', () => {
    render(<MergeBanner isBlocked={false} mergeState={makeMergeState({ canComplete: false })} />)
    expect(screen.getByRole('button', { name: 'マージを完了' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'マージを中止' })).toBeEnabled()
  })

  it('canComplete が真なら「マージを完了」が有効で、クリックで onComplete が呼ばれる', async () => {
    const mergeState = makeMergeState({ unresolvedCount: 0, canComplete: true })
    render(<MergeBanner isBlocked={false} mergeState={mergeState} />)
    await userEvent.click(screen.getByRole('button', { name: 'マージを完了' }))
    expect(mergeState.onComplete).toHaveBeenCalledTimes(1)
  })

  it('「マージを中止」のクリックで onAbort が呼ばれる', async () => {
    const mergeState = makeMergeState()
    render(<MergeBanner isBlocked={false} mergeState={mergeState} />)
    await userEvent.click(screen.getByRole('button', { name: 'マージを中止' }))
    expect(mergeState.onAbort).toHaveBeenCalledTimes(1)
  })

  it('完了の実行中は「完了中...」を出し、両方のボタンが disabled になる', () => {
    render(
      <MergeBanner
        isBlocked={false}
        mergeState={makeMergeState({
          unresolvedCount: 0,
          canComplete: true,
          pendingOperation: 'complete'
        })}
      />
    )
    expect(screen.getByRole('button', { name: '完了中' })).toHaveTextContent('完了中...')
    expect(screen.getByRole('button', { name: '完了中' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'マージを中止' })).toBeDisabled()
  })

  it('中止の実行中は「中止中...」を出し、両方のボタンが disabled になる', () => {
    render(
      <MergeBanner
        isBlocked={false}
        mergeState={makeMergeState({
          unresolvedCount: 0,
          canComplete: true,
          pendingOperation: 'abort'
        })}
      />
    )
    expect(screen.getByRole('button', { name: '中止中' })).toHaveTextContent('中止中...')
    expect(screen.getByRole('button', { name: '中止中' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'マージを完了' })).toBeDisabled()
  })

  it('error を role="alert" で出す', () => {
    render(
      <MergeBanner
        isBlocked={false}
        mergeState={makeMergeState({ error: new Error('完了できません') })}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('完了できません')
  })

  it('error が無ければ alert を出さない', () => {
    render(<MergeBanner isBlocked={false} mergeState={makeMergeState()} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('他の操作中(isBlocked)は、完了できる状態でも両方のボタンが disabled になる', () => {
    render(
      <MergeBanner
        isBlocked
        mergeState={makeMergeState({ unresolvedCount: 0, canComplete: true })}
      />
    )
    expect(screen.getByRole('button', { name: 'マージを完了' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'マージを中止' })).toBeDisabled()
  })
})
