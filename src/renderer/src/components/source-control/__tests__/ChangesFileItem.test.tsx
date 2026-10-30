import { render, screen, fireEvent } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import ChangesFileItem from '../ChangesFileItem'

type ItemProps = React.ComponentProps<typeof ChangesFileItem>

// ボタンは行の hover でのみ表示される(main.css)が、このテストでは CSS を読み込まないため
// 常に表示され、role と name で取得できる
const renderItem = (overrides: Partial<ItemProps> = {}): RenderResult =>
  render(
    <ul>
      <ChangesFileItem
        file={{ path: 'src/a.ts', index: ' ', workingDir: 'M' }}
        isOperationBlocked={false}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onOpenDiff={vi.fn()}
        {...overrides}
      />
    </ul>
  )

describe('ChangesFileItem', () => {
  it.each([
    ['変更', { path: 'a.ts', index: ' ', workingDir: 'M' }, 'M'],
    ['削除', { path: 'a.ts', index: ' ', workingDir: 'D' }, 'D'],
    ['未追跡', { path: 'a.ts', index: '?', workingDir: '?' }, 'U']
  ] as const)('%s のステータス文字を表示する', (_label, file: GitFileStatus, char) => {
    renderItem({ file })
    expect(screen.getByText(char)).toBeInTheDocument()
  })

  it('パスを押すと onOpenDiff、+ で onStage、↶ で onDiscard がパスで呼ばれる', () => {
    const onOpenDiff = vi.fn()
    const onStage = vi.fn()
    const onDiscard = vi.fn()
    renderItem({ onOpenDiff, onStage, onDiscard })
    fireEvent.click(screen.getByRole('button', { name: 'src/a.ts の未ステージ差分を表示' }))
    fireEvent.click(screen.getByRole('button', { name: 'src/a.ts をステージ' }))
    fireEvent.click(screen.getByRole('button', { name: 'src/a.ts の変更を取り消し' }))
    expect(onOpenDiff).toHaveBeenCalledWith('src/a.ts')
    expect(onStage).toHaveBeenCalledWith('src/a.ts')
    expect(onDiscard).toHaveBeenCalledWith('src/a.ts')
  })

  // 取り消しもステージと同じ直列化で実行されるため、disabled 条件を共有する
  it('isOperationBlocked のとき、ステージと取り消しの両方が disabled になる', () => {
    renderItem({ isOperationBlocked: true })
    expect(screen.getByRole('button', { name: 'src/a.ts をステージ' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'src/a.ts の変更を取り消し' })).toBeDisabled()
  })

  it('isOperationBlocked のときも、差分の表示は押せる', () => {
    renderItem({ isOperationBlocked: true })
    expect(
      screen.getByRole('button', { name: 'src/a.ts の未ステージ差分を表示' })
    ).not.toBeDisabled()
  })

  // main 側も ls-files -u で拒否するが、押せるのに必ず失敗するボタンを出さない
  // + (git add) はマーカー入りのまま解決済みにしてしまう。解決ビューの「解決済みにする」へ誘導する
  it('コンフリクト中は取り消しボタンもステージボタンも出さず、差分(解決ビュー)を開くパスは出す', () => {
    renderItem({ file: { path: 'c.txt', index: 'U', workingDir: 'U' } })
    expect(screen.queryByRole('button', { name: 'c.txt の変更を取り消し' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'c.txt をステージ' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'c.txt の未ステージ差分を表示' })).toBeInTheDocument()
  })

  it('通常の変更の行にはステージボタンがある', () => {
    renderItem({ file: { path: 'src/a.ts', index: ' ', workingDir: 'M' } })
    expect(screen.getByRole('button', { name: 'src/a.ts をステージ' })).toBeInTheDocument()
  })

  it('未追跡ファイルにも取り消しボタンがある', () => {
    renderItem({ file: { path: 'new.txt', index: '?', workingDir: '?' } })
    expect(screen.getByRole('button', { name: 'new.txt の変更を取り消し' })).toBeInTheDocument()
  })

  describe('行の形', () => {
    const row = (): HTMLElement =>
      screen.getByRole('button', { name: 'src/lib/a.ts の未ステージ差分を表示' })
        .parentElement as HTMLElement

    it('差分を開くボタン、操作の枠、状態の文字が li の直下に兄弟として並ぶ', () => {
      renderItem({ file: { path: 'src/lib/a.ts', index: ' ', workingDir: 'M' } })
      const [open, actions, status] = Array.from(row().children)
      expect(row().tagName).toBe('LI')
      expect(row().children).toHaveLength(3)
      expect(open.tagName).toBe('BUTTON')
      expect(actions).toHaveClass('source-control-panel__file-actions')
      expect(actions).toContainElement(screen.getByLabelText('src/lib/a.ts をステージ'))
      expect(status).toHaveTextContent('M')
    })

    it('ファイル名の次にフォルダのパスを出し、全文を title に入れる', () => {
      renderItem({ file: { path: 'src/lib/a.ts', index: ' ', workingDir: 'M' } })
      const open = screen.getByRole('button', { name: 'src/lib/a.ts の未ステージ差分を表示' })
      const name = screen.getByText('a.ts')
      const dir = screen.getByText('src/lib')
      expect(open).toContainElement(name)
      expect(open).toContainElement(dir)
      expect(name.compareDocumentPosition(dir) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(open).toHaveAttribute('title', 'src/lib/a.ts')
    })

    it('直下のファイルにはフォルダの要素を出さない', () => {
      const { container } = renderItem({
        file: { path: 'README.md', index: ' ', workingDir: 'M' }
      })
      expect(container.querySelector('.source-control-panel__file-dir')).toBeNull()
    })

    it('コンフリクトの行は操作の枠が空で、状態の文字は最後に並ぶ', () => {
      renderItem({ file: { path: 'src/lib/a.ts', index: 'U', workingDir: 'U' } })
      expect(row().querySelector('.source-control-panel__file-actions')).toBeEmptyDOMElement()
      expect(row().lastElementChild).toHaveTextContent('U')
    })

    it('行の button はエージェントの行のクラスを使わない', () => {
      renderItem({ file: { path: 'src/lib/a.ts', index: ' ', workingDir: 'M' } })
      const open = screen.getByRole('button', { name: 'src/lib/a.ts の未ステージ差分を表示' })
      expect(open).not.toHaveClass('source-control-panel__file-path')
      expect(row().lastElementChild).not.toHaveClass('source-control-panel__file-status--changed')
    })
  })
})
