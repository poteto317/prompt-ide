import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_INSTRUCTION_FILES,
  agentInstructionRelativePath
} from '@shared/agentInstructionFiles'
import AgentInstructionFilesSection from '../AgentInstructionFilesSection'
import { makeAgentInstructionsPanelState } from '../../../__tests__/makeAgentInstructionsPanelState'
import type { AgentInstructionFileRow, AgentInstructionsPanelState } from '../../../types'

const claudeRows = (existing: string[]): AgentInstructionFileRow[] =>
  AGENT_INSTRUCTION_FILES.claude.map((file) => {
    const relativePath = agentInstructionRelativePath(file)
    return {
      file,
      relativePath,
      node: existing.includes(relativePath)
        ? {
            name: file.segments[file.segments.length - 1],
            path: `/p/${relativePath}`,
            type: 'file'
          }
        : null
    }
  })

/** 小見出し `このフォルダ` の直後の一覧(全体の一覧・サブフォルダの一覧と区別する) */
const thisFolderList = (): HTMLElement => {
  const heading = screen.getByRole('heading', { level: 4, name: 'このフォルダ' })
  const list = heading.nextElementSibling
  if (!(list instanceof HTMLElement) || list.tagName !== 'UL')
    throw new Error('このフォルダ の一覧が無い')
  return list
}

/** 小見出し `全体(すべてのプロジェクト)` の直後の一覧 */
const globalList = (): HTMLElement => {
  const heading = screen.getByRole('heading', { level: 4, name: '全体(すべてのプロジェクト)' })
  const list = heading.nextElementSibling
  if (!(list instanceof HTMLElement) || list.tagName !== 'UL') throw new Error('全体 の一覧が無い')
  return list
}

describe('AgentInstructionFilesSection', () => {
  it('見出しに CLI の表示名を出す', () => {
    render(
      <AgentInstructionFilesSection state={makeAgentInstructionsPanelState()} isBlocked={false} />
    )
    expect(
      screen.getByRole('region', { name: 'エージェントの指示ファイル(Claude Code)' })
    ).toBeInTheDocument()
  })

  it('copilot → 見出しは GitHub Copilot CLI', () => {
    const rows = AGENT_INSTRUCTION_FILES.copilot.map((file) => ({
      file,
      relativePath: agentInstructionRelativePath(file),
      node: null
    }))
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ cliKind: 'copilot', rows })}
        isBlocked={false}
      />
    )
    expect(
      screen.getByRole('region', { name: 'エージェントの指示ファイル(GitHub Copilot CLI)' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AGENTS.md を作成' })).toBeInTheDocument()
  })

  it('ある行は 開く、無い行は 作成。行にパスと説明を出す', () => {
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ rows: claudeRows(['CLAUDE.md']) })}
        isBlocked={false}
      />
    )
    const items = within(thisFolderList()).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('CLAUDE.md')).toBeInTheDocument()
    expect(within(items[0]).getByText('共有の指示')).toBeInTheDocument()
    expect(within(items[0]).getByRole('button', { name: 'CLAUDE.md を開く' })).toHaveTextContent(
      '開く'
    )
    expect(
      within(items[1]).getByRole('button', { name: '.claude/CLAUDE.md を作成' })
    ).toHaveTextContent('作成')
  })

  it('開く・作成 → state の open・create をその行で呼ぶ', async () => {
    const state = makeAgentInstructionsPanelState({ rows: claudeRows(['CLAUDE.md']) })
    render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'CLAUDE.md を開く' }))
    expect(state.open).toHaveBeenCalledWith(state.rows[0])
    await userEvent.click(screen.getByRole('button', { name: 'CLAUDE.local.md を作成' }))
    expect(state.create).toHaveBeenCalledWith(state.rows[2])
  })

  it('clone 中 → 開閉のボタン以外のすべてのボタンが disabled', () => {
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ rows: claudeRows(['CLAUDE.md']) })}
        isBlocked
      />
    )
    for (const button of screen.getAllByRole('button')) {
      if (button.hasAttribute('aria-expanded')) expect(button).not.toBeDisabled()
      else expect(button).toBeDisabled()
    }
  })

  it('作成中 → disabled ではなく aria-disabled="true"。押しても open・create を呼ばない', async () => {
    const state = makeAgentInstructionsPanelState({
      rows: claudeRows(['CLAUDE.md']),
      isCreating: true
    })
    render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
    for (const button of screen.getAllByRole('button')) {
      if (button.hasAttribute('aria-expanded')) continue
      expect(button).not.toBeDisabled()
      expect(button).toHaveAttribute('aria-disabled', 'true')
    }
    await userEvent.click(screen.getByRole('button', { name: 'CLAUDE.md を開く' }))
    await userEvent.click(screen.getByRole('button', { name: 'CLAUDE.local.md を作成' }))
    expect(state.open).not.toHaveBeenCalled()
    expect(state.create).not.toHaveBeenCalled()
  })

  it('作成中でなければ aria-disabled を付けない', () => {
    render(
      <AgentInstructionFilesSection state={makeAgentInstructionsPanelState()} isBlocked={false} />
    )
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAttribute('aria-disabled')
    }
  })

  it('押した 作成 が作成中に変わっても、フォーカスは押したボタンに残る(body に落ちない)', async () => {
    const rows = claudeRows([])
    const { rerender } = render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ rows })}
        isBlocked={false}
      />
    )
    const button = screen.getByRole('button', { name: 'CLAUDE.md を作成' })
    button.focus()
    expect(document.activeElement).toBe(button)
    rerender(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ rows, isCreating: true })}
        isBlocked={false}
      />
    )
    expect(screen.getByRole('button', { name: 'CLAUDE.md を作成' })).toBe(button)
    expect(document.activeElement).toBe(button)
  })

  it('文言 → role=alert で出す。無ければ alert は無い', () => {
    const { rerender } = render(
      <AgentInstructionFilesSection state={makeAgentInstructionsPanelState()} isBlocked={false} />
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    rerender(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ message: 'フォルダの外には作成できません' })}
        isBlocked={false}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('フォルダの外には作成できません')
  })

  it('文言 → 「全体」の一覧の後、サブフォルダの開閉のボタンより前に置く(節が縮んで中でスクロールしても隠れない)', () => {
    const subfolderRows = [
      {
        relativePath: 'src/CLAUDE.md',
        description: '共有の指示',
        node: { name: 'CLAUDE.md', path: '/p/src/CLAUDE.md', type: 'file' as const }
      }
    ]
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({
          subfolderRows,
          subfolderTotal: 1,
          message: '同じ名前のファイルかフォルダが既にあります'
        })}
        isBlocked={false}
      />
    )
    const alert = screen.getByRole('alert')
    const list = thisFolderList()
    const global = globalList()
    const toggle = screen.getByRole('button', { name: 'サブフォルダ(1 件)' })
    expect(list.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(global.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(alert.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  describe('文言が出たときのスクロール', () => {
    const original = Element.prototype.scrollIntoView
    let scrollIntoView: ReturnType<typeof vi.fn>
    beforeEach(() => {
      scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof original
    })
    afterEach(() => {
      Element.prototype.scrollIntoView = original
    })
    const withMessage = (message: string | null): AgentInstructionsPanelState =>
      makeAgentInstructionsPanelState({ message })

    it('文言が出たら nearest で 1 回呼ぶ。文言が無いときは呼ばない', () => {
      const { rerender } = render(
        <AgentInstructionFilesSection state={withMessage(null)} isBlocked={false} />
      )
      expect(scrollIntoView).not.toHaveBeenCalled()
      rerender(<AgentInstructionFilesSection state={withMessage('失敗')} isBlocked={false} />)
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('alert'))
    })

    it('同じ文言のまま再描画しても、もう一度は呼ばない', () => {
      const { rerender } = render(
        <AgentInstructionFilesSection state={withMessage('失敗')} isBlocked={false} />
      )
      rerender(<AgentInstructionFilesSection state={withMessage('失敗')} isBlocked={false} />)
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    })
  })

  it('小見出し「このフォルダ」の下に今の行、その下にサブフォルダの開閉のボタン', async () => {
    const subfolderRows = [
      {
        relativePath: 'src/CLAUDE.md',
        description: '共有の指示',
        node: { name: 'CLAUDE.md', path: '/p/src/CLAUDE.md', type: 'file' as const }
      }
    ]
    const state = makeAgentInstructionsPanelState({ subfolderRows, subfolderTotal: 1 })
    render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
    const heading = screen.getByRole('heading', { level: 4, name: 'このフォルダ' })
    const list = thisFolderList()
    const toggle = screen.getByRole('button', { name: 'サブフォルダ(1 件)' })
    // 見出し → 今の行の ul → 開閉のボタン、の順
    expect(heading.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(list.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(list).toContainElement(screen.getByRole('button', { name: 'CLAUDE.md を作成' }))
    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('button', { name: 'src/CLAUDE.md を開く' }))
    expect(state.openSubfolderFile).toHaveBeenCalledWith(subfolderRows[0])
  })

  it('全体の一覧 → このフォルダの一覧の後、失敗の文言とサブフォルダの開閉のボタンの前', () => {
    render(
      <AgentInstructionFilesSection
        state={makeAgentInstructionsPanelState({ message: '失敗' })}
        isBlocked={false}
      />
    )
    const globalHeading = screen.getByRole('heading', {
      level: 4,
      name: '全体(すべてのプロジェクト)'
    })
    const thisFolder = screen.getByRole('heading', { level: 4, name: 'このフォルダ' })
    const alert = screen.getByRole('alert')
    const toggle = screen.getByRole('button', { name: /サブフォルダ/ })
    const follows = (a: Element, b: Element): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(follows(thisFolderList(), globalHeading)).toBe(true)
    expect(follows(thisFolder, globalHeading)).toBe(true)
    expect(follows(globalHeading, alert)).toBe(true)
    expect(follows(alert, toggle)).toBe(true)
    expect(within(globalList()).getAllByRole('listitem')).toHaveLength(1)
  })

  it('全体の 作成 → state.createGlobal を呼ぶ', async () => {
    const state = makeAgentInstructionsPanelState()
    render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
    await userEvent.click(screen.getByRole('button', { name: '~/.claude/CLAUDE.md を作成' }))
    expect(state.createGlobal).toHaveBeenCalledTimes(1)
  })

  it('全体の 開く → state.openGlobal を呼ぶ', async () => {
    const state = makeAgentInstructionsPanelState({
      globalRow: {
        kind: 'exists',
        displayPath: '~/.claude/CLAUDE.md',
        description: '個人の指示(全部のプロジェクトに効きます)',
        node: { type: 'file', name: '~/.claude/CLAUDE.md', path: '/h/.claude/CLAUDE.md' }
      }
    })
    render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
    await userEvent.click(screen.getByRole('button', { name: '~/.claude/CLAUDE.md を開く' }))
    expect(state.openGlobal).toHaveBeenCalledTimes(1)
  })

  it('作成の途中 → 全体の 作成 は aria-disabled で、押しても createGlobal を呼ばない', async () => {
    const state = makeAgentInstructionsPanelState({ isCreating: true })
    render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
    const button = screen.getByRole('button', { name: '~/.claude/CLAUDE.md を作成' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(button)
    expect(state.createGlobal).not.toHaveBeenCalled()
  })

  describe('サブフォルダの一覧への受け渡し', () => {
    const subfolderRows = [
      {
        relativePath: 'src/CLAUDE.md',
        description: '共有の指示',
        node: { name: 'CLAUDE.md', path: '/p/src/CLAUDE.md', type: 'file' as const }
      }
    ]
    const openSubfolder = async (): Promise<HTMLElement> => {
      await userEvent.click(screen.getByRole('button', { name: 'サブフォルダ(1 件)' }))
      return screen.getByRole('button', { name: 'src/CLAUDE.md を開く' })
    }

    it('isBlocked → サブフォルダの 開く が disabled', async () => {
      const state = makeAgentInstructionsPanelState({ subfolderRows, subfolderTotal: 1 })
      render(<AgentInstructionFilesSection state={state} isBlocked />)
      expect(await openSubfolder()).toBeDisabled()
    })

    it('作成の途中 → サブフォルダの 開く は aria-disabled で、押しても呼ばない', async () => {
      const state = makeAgentInstructionsPanelState({
        subfolderRows,
        subfolderTotal: 1,
        isCreating: true
      })
      render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
      const open = await openSubfolder()
      expect(open).toHaveAttribute('aria-disabled', 'true')
      await userEvent.click(open)
      expect(state.openSubfolderFile).not.toHaveBeenCalled()
    })
  })

  describe('更新', () => {
    const refreshButton = (): HTMLElement =>
      screen.getByRole('button', { name: '指示ファイルの一覧を更新' })

    it('見出しの行に出す。文字は 更新、title で何をするかを示す。押すと refresh を呼ぶ', async () => {
      const state = makeAgentInstructionsPanelState()
      render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
      expect(refreshButton()).toHaveTextContent('更新')
      expect(refreshButton()).toHaveAttribute(
        'title',
        'ファイルツリーを読み直し、全体の指示ファイルの有無も確かめ直します'
      )
      await userEvent.click(refreshButton())
      expect(state.refresh).toHaveBeenCalledTimes(1)
    })

    it('clone 中 → disabled', () => {
      render(<AgentInstructionFilesSection state={makeAgentInstructionsPanelState()} isBlocked />)
      expect(refreshButton()).toBeDisabled()
    })

    it.each<[string, Partial<AgentInstructionsPanelState>]>([
      ['作成の途中', { isCreating: true }],
      ['更新の途中', { isRefreshing: true }]
    ])(
      '%s → aria-disabled で、押しても refresh を呼ばず、フォーカスが残る',
      async (_label, change) => {
        const state = makeAgentInstructionsPanelState(change)
        render(<AgentInstructionFilesSection state={state} isBlocked={false} />)
        const button = refreshButton()
        expect(button).not.toBeDisabled()
        expect(button).toHaveAttribute('aria-disabled', 'true')
        await userEvent.click(button)
        expect(state.refresh).not.toHaveBeenCalled()
        expect(document.activeElement).toBe(button)
      }
    )

    // 回帰のテスト。読み直しの失敗も作成の失敗と同じ message の経路で出る(新しい経路は足していない)
    it('読み直しの失敗の文言 → 節の role=alert に出す(回帰)', () => {
      render(
        <AgentInstructionFilesSection
          state={makeAgentInstructionsPanelState({
            message: 'ファイルツリーを読み直せませんでした'
          })}
          isBlocked={false}
        />
      )
      expect(screen.getByRole('alert')).toHaveTextContent('ファイルツリーを読み直せませんでした')
    })
  })
})
