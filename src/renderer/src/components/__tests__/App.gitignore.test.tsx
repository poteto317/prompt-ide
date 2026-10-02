import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// gitApi をまるごとモックする。App.commit.test.tsx と同じ方針
vi.mock('../../lib/gitApi', () => ({
  getGitStatus: vi.fn(),
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  commitChanges: vi.fn(),
  getDiff: vi.fn(),
  stageHunk: vi.fn(),
  unstageHunk: vi.fn(),
  getLog: vi.fn(),
  getBranches: vi.fn(),
  getTags: vi.fn(),
  amendCommit: vi.fn()
}))

import * as gitApi from '../../lib/gitApi'
import App from '../../App'

const mockGetGitStatus = vi.mocked(gitApi.getGitStatus)

describe('App: .gitignore への追加後の Changes 一覧反映', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi
      .fn()
      .mockResolvedValue([{ name: 'temp.log', path: '/project/temp.log', type: 'file' }])
    window.api.addToGitignore = vi.fn().mockResolvedValue(undefined)
    mockGetGitStatus.mockResolvedValue({
      isRepo: true,
      mergeInProgress: false,
      hasOrigin: true,
      hasRemote: true,
      upstream: 'origin/main',
      detached: false,
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [{ path: 'temp.log', index: '?', workingDir: '?' }]
    })
  })

  it('.gitignore への追加が成功したら、git status を再取得して Changes 一覧から対象ファイルを消す', async () => {
    // 追加前は Changes 一覧に未追跡ファイルとして表示されている状態を作る。
    // handleAddToGitignore が refreshGitStatus を呼ばないと、addToGitignore 自体は
    // 成功していても Changes 一覧が古いまま(消えたはずのファイルが残る)になる
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
    )

    const fileTree = screen.getByRole('tree')
    fireEvent.contextMenu(within(fileTree).getByText('temp.log'))
    await userEvent.click(screen.getByText('.gitignore に追加'))
    await waitFor(() => expect(window.api.addToGitignore).toHaveBeenCalledWith('/project/temp.log'))

    // .gitignore 追加後、そのファイルはもう Changes 一覧に出てこない
    mockGetGitStatus.mockResolvedValue({
      isRepo: true,
      mergeInProgress: false,
      hasOrigin: true,
      hasRemote: true,
      upstream: 'origin/main',
      detached: false,
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: []
    })

    await waitFor(() => expect(mockGetGitStatus).toHaveBeenCalledTimes(2))
  })

  it('フォルダを切り替えたら、前のフォルダの .gitignore エラー表示を消す', async () => {
    // 消さないと、フォルダ A で追加に失敗(権限エラー等)した後に B を開いても、
    // B のエクスプローラーに A のパスを含む赤いエラーが残り続ける。
    // useFileSystem の error は openFolder で明示的にクリアされており、
    // gitignoreError だけが取り残されていた
    window.api.addToGitignore = vi.fn().mockRejectedValue(new Error('EACCES: 権限がありません'))
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
    )

    const fileTree = screen.getByRole('tree')
    fireEvent.contextMenu(within(fileTree).getByText('temp.log'))
    await userEvent.click(screen.getByText('.gitignore に追加'))
    await waitFor(() => expect(screen.getByText(/EACCES/)).toBeInTheDocument())

    // 別フォルダを開く
    window.api.openFolder = vi.fn().mockResolvedValue('/other')
    window.api.readDirectory = vi.fn().mockResolvedValue([])
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを変更' }))

    await waitFor(() => expect(screen.queryByText(/EACCES/)).not.toBeInTheDocument())
  })

  it('addToGitignore の完了前にフォルダを切り替えた場合、その後の失敗を新しいフォルダのエラーとして表示しない', async () => {
    // useOnChange による gitignoreError クリアは folderPath が変わった瞬間の
    // 1回だけ。addToGitignore の IPC 呼び出し自体はブロックされないため、
    // フォルダ A での「.gitignore に追加」がまだ実行中の間に B へ切り替えることが
    // できる。その後 A の呼び出しが失敗すると、catch 節が現在のフォルダを
    // 確認せず無条件に setGitignoreError を呼んでいたため、無関係な B の画面に
    // A の古いエラーが表示されてしまう
    let rejectAddToGitignore: (err: Error) => void = () => {}
    window.api.addToGitignore = vi
      .fn()
      .mockImplementation(() => new Promise((_resolve, reject) => (rejectAddToGitignore = reject)))
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
    )

    const fileTree = screen.getByRole('tree')
    fireEvent.contextMenu(within(fileTree).getByText('temp.log'))
    await userEvent.click(screen.getByText('.gitignore に追加'))
    await waitFor(() => expect(window.api.addToGitignore).toHaveBeenCalled())

    // A の addToGitignore がまだ未解決のまま、B へ切り替える
    window.api.openFolder = vi.fn().mockResolvedValue('/other')
    window.api.readDirectory = vi.fn().mockResolvedValue([])
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを変更' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
    )

    // ここで A の addToGitignore が失敗する
    rejectAddToGitignore(new Error('EACCES: 権限がありません'))

    // B の画面に A の古いエラーが表示されない
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText(/EACCES/)).not.toBeInTheDocument()
  })

  it('ツリー再読み込みの失敗を .gitignore 追加の失敗として表示しない', async () => {
    // .gitignore の書き込みは成功しているのに、後段のフォルダ走査が失敗しただけで
    // 「.gitignore に追加できなかった」というエラーが出ると、ユーザーは追加が
    // 失敗したと誤解して再実行してしまう。走査エラーはツリー側の error スロットが
    // 既に報告している
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
    )

    // 追加後のツリー再読み込みだけを失敗させる。refreshTree は自身の error
    // スロットへ報告した上で reject するため、その reject を .gitignore 追加の
    // 失敗として拾ってはいけない
    const scanError = new Error('フォルダの走査に失敗しました')
    window.api.readDirectory = vi.fn().mockRejectedValue(scanError)

    const fileTree = screen.getByRole('tree')
    fireEvent.contextMenu(within(fileTree).getByText('temp.log'))
    await userEvent.click(screen.getByText('.gitignore に追加'))
    await waitFor(() => expect(window.api.addToGitignore).toHaveBeenCalled())
    await waitFor(() => expect(window.api.readDirectory).toHaveBeenCalled())

    // refreshTree は自身の folderLoadError スロットへ報告した上で reject する。
    // その reject を gitignoreError として拾うと、エクスプローラーに
    // 「.gitignore への追加が失敗した」ように見えるエラーが出て、ユーザーは
    // 追加が失敗したと誤解して再実行してしまう(実際には書き込み済み)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText('フォルダの走査に失敗しました')).not.toBeInTheDocument()
  })

  it('.gitignore への追加が成功したら、ファイルツリーも再読み込みする(新規作成された .gitignore を表示するため)', async () => {
    // .gitignore がまだ無いフォルダで初めて追加した場合、ツリーを読み直さないと
    // 作成されたはずの .gitignore がエクスプローラーに現れない
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
    )
    const readDirectoryCallsBefore = vi.mocked(window.api.readDirectory).mock.calls.length

    // 追加後のツリーには .gitignore が含まれる
    window.api.readDirectory = vi.fn().mockResolvedValue([
      { name: '.gitignore', path: '/project/.gitignore', type: 'file' },
      { name: 'temp.log', path: '/project/temp.log', type: 'file' }
    ])

    const fileTree = screen.getByRole('tree')
    fireEvent.contextMenu(within(fileTree).getByText('temp.log'))
    await userEvent.click(screen.getByText('.gitignore に追加'))
    await waitFor(() => expect(window.api.addToGitignore).toHaveBeenCalled())

    await waitFor(() =>
      expect(vi.mocked(window.api.readDirectory).mock.calls.length).toBeGreaterThan(0)
    )
    expect(readDirectoryCallsBefore).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByText('.gitignore')).toBeInTheDocument())
  })
})
