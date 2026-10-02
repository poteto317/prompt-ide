import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import RemoteSetupBanner from '../RemoteSetupBanner'
import NotRepositoryView from '../NotRepositoryView'
import InitRepositoryDialog from '../InitRepositoryDialog'
import { SETTING_UPSTREAM_NOTICE } from '../../../lib/remoteSetupState'
import { makeRemoteSetupPanelState } from '../../../__tests__/makeRemoteSetupPanelState'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// バナーのボタンと「リポジトリを初期化」は、退避・マージのバナーのボタンと 1 つのグループセレクタで宣言を共有する
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

describe('リモートの管理のスタイル(main.css)', () => {
  it('バナーはマージのバナーと同じく横並びで、ボタンは 32px 四方以上の枠付きボタンになる', () => {
    render(
      <RemoteSetupBanner
        kind="no-origin"
        branch="main"
        remoteSetup={makeRemoteSetupPanelState()}
        isBlocked={false}
        requestFocus={vi.fn()}
      />
    )
    const section = screen.getByRole('status').parentElement as HTMLElement
    expect(getComputedStyle(section).display).toBe('flex')
    const style = getComputedStyle(screen.getByRole('button', { name: 'リモートを追加' }))
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
    expect(style.borderTopStyle).toBe('solid')
    expect(style.cursor).toBe('pointer')
  })

  it('disabled のボタンは半透明で、カーソルが既定に戻る', () => {
    render(
      <RemoteSetupBanner
        kind="no-upstream"
        branch="main"
        remoteSetup={makeRemoteSetupPanelState()}
        isBlocked={true}
        requestFocus={vi.fn()}
      />
    )
    const style = getComputedStyle(
      screen.getByRole('button', { name: '初回 push（upstream を設定）' })
    )
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('default')
  })

  // `/` `.` `_` では折り返されない長いブランチ名が、枠からはみ出さない(パターン 90)
  it('バナーの文言は途中でも折り返す', () => {
    render(
      <RemoteSetupBanner
        kind="no-upstream"
        branch="release/2024.01.15_hotfix_for_customer_contoso_emergency_patch_v2"
        remoteSetup={makeRemoteSetupPanelState()}
        isBlocked={false}
        requestFocus={vi.fn()}
      />
    )
    expect(getComputedStyle(screen.getByRole('status')).overflowWrap).toBe('anywhere')
  })

  it('「リポジトリを初期化」は 32px 四方以上の枠付きボタンになる', () => {
    render(
      <NotRepositoryView
        remoteSetup={makeRemoteSetupPanelState()}
        isBlocked={false}
        requestFocus={vi.fn()}
      />
    )
    const style = getComputedStyle(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
    expect(style.borderTopStyle).toBe('solid')
  })

  it('初期化中の「リポジトリを初期化」は半透明で、カーソルが既定に戻る', () => {
    render(
      <NotRepositoryView
        remoteSetup={makeRemoteSetupPanelState({ isInitializing: true })}
        isBlocked={false}
        requestFocus={vi.fn()}
      />
    )
    const style = getComputedStyle(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('default')
  })

  it('ダイアログの説明とラベルは小さい補足の文字になる', async () => {
    render(
      <NotRepositoryView
        remoteSetup={makeRemoteSetupPanelState()}
        isBlocked={false}
        requestFocus={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    expect(
      getComputedStyle(screen.getByText('このフォルダに空の Git リポジトリを作成します')).fontSize
    ).toBe('11px')
    expect(getComputedStyle(screen.getByText('ブランチ名')).fontSize).toBe('11px')
  })

  // 初回 push 中の案内は、ダイアログの説明と同じ小さい補足の文字で、文言とボタンの下の行に出す
  it('初回 push 中の案内は小さい補足の文字で、1 行を占める', () => {
    render(
      <RemoteSetupBanner
        kind="no-upstream"
        branch="main"
        remoteSetup={makeRemoteSetupPanelState({ isSettingUpstream: true, isPushing: true })}
        isBlocked={false}
        requestFocus={vi.fn()}
      />
    )
    const style = getComputedStyle(screen.getByText(SETTING_UPSTREAM_NOTICE))
    expect(style.fontSize).toBe('11px')
    expect(style.flexBasis).toBe('100%')
  })

  // 実行中は実行ボタンとキャンセルの両方が disabled になる。対の片方だけ押せるように見えないこと(パターン 90)
  it('実行中のダイアログでは、実行ボタンとキャンセルがどちらも半透明で、カーソルが既定に戻る', () => {
    render(
      <InitRepositoryDialog
        isRunning={true}
        isBlocked={false}
        error={null}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    )
    for (const name of ['初期化中...', 'キャンセル']) {
      const style = getComputedStyle(screen.getByRole('button', { name }))
      expect(style.opacity).toBe('0.5')
      expect(style.cursor).toBe('default')
    }
  })
})
