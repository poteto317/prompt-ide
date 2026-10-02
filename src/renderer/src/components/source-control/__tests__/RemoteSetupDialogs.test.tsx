import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import InitRepositoryDialog from '../InitRepositoryDialog'
import AddRemoteDialog from '../AddRemoteDialog'

const common = { isBlocked: false, error: null, onCancel: vi.fn() }

describe('InitRepositoryDialog', () => {
  it('見出し・説明・既定値 main のブランチ名と、初期化のボタンを出す', () => {
    render(<InitRepositoryDialog {...common} isRunning={false} onSubmit={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'リポジトリを初期化' })).toHaveAccessibleDescription(
      'このフォルダに空の Git リポジトリを作成します'
    )
    expect(screen.getByRole('textbox', { name: 'ブランチ名' })).toHaveValue('main')
    expect(screen.getByRole('button', { name: '初期化' })).toBeEnabled()
  })

  it.each([
    ['', '名前を入力してください'],
    ['-x', '`-` で始まる名前は使用できません'],
    ['@', 'この名前は使用できません']
  ])('ブランチ名 %j は %s', async (name, message) => {
    render(<InitRepositoryDialog {...common} isRunning={false} onSubmit={vi.fn()} />)
    const field = screen.getByRole('textbox', { name: 'ブランチ名' })
    await userEvent.clear(field)
    if (name !== '') await userEvent.type(field, name)
    expect(field).toHaveAccessibleDescription(message)
    expect(screen.getByRole('button', { name: '初期化' })).toBeDisabled()
  })

  // main の入口と同じ正規化(前後の空白・NFC)をした名前を送る(パターン 83)
  it('前後の空白を除き NFC にそろえた名前を送る', async () => {
    const onSubmit = vi.fn()
    render(<InitRepositoryDialog {...common} isRunning={false} onSubmit={onSubmit} />)
    const field = screen.getByRole('textbox', { name: 'ブランチ名' })
    await userEvent.clear(field)
    await userEvent.type(field, '  café  {Enter}')
    expect(onSubmit).toHaveBeenCalledWith('café')
  })

  it('実行中は「初期化中...」と案内「初期化中です」を出す', () => {
    render(<InitRepositoryDialog {...common} isRunning={true} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: '初期化中...' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('初期化中です')
  })
})

describe('AddRemoteDialog', () => {
  it('見出し・説明・空の URL 欄と、追加のボタン(未入力の間は disabled)を出す', () => {
    render(<AddRemoteDialog {...common} isRunning={false} onSubmit={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'リモートを追加' })).toHaveAccessibleDescription(
      'リモート origin を追加します（この時点では接続しません）'
    )
    const field = screen.getByRole('textbox', { name: 'URL' })
    expect(field).toHaveValue('')
    expect(field).toHaveAccessibleDescription('URL を入力してください')
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()
  })

  it('許可されない形式の URL は理由を出して追加を disabled にする', async () => {
    render(<AddRemoteDialog {...common} isRunning={false} onSubmit={vi.fn()} />)
    const field = screen.getByRole('textbox', { name: 'URL' })
    await userEvent.type(field, 'ext::sh')
    expect(field).toHaveAccessibleDescription(
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    )
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()
  })

  it('前後の空白だけを除いた URL を送る', async () => {
    const onSubmit = vi.fn()
    render(<AddRemoteDialog {...common} isRunning={false} onSubmit={onSubmit} />)
    await userEvent.type(
      screen.getByRole('textbox', { name: 'URL' }),
      '  https://github.com/a/b.git  {Enter}'
    )
    expect(onSubmit).toHaveBeenCalledWith('https://github.com/a/b.git')
  })

  it('実行中は「追加中...」と案内「追加中です」を出す', () => {
    render(<AddRemoteDialog {...common} isRunning={true} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: '追加中...' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('追加中です')
  })
})
