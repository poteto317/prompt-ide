import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { OpenedFileEvent } from '../../hooks/useFileSystem'
import type { OpenFile } from '../../types'
import type { DiffTabKey } from '../../hooks/useDiffTabs'
import EditorPanel from '../EditorPanel'
import { makeConflictFileState } from '../../__tests__/makeConflictFileState'
import { makeAgentSessionsState } from '../../__tests__/makeAgentSessionsState'
import type { AgentTerminalPanelState } from '../../hooks/useAgentWorkspace'

const file: OpenFile = {
  path: '/p/a.ts',
  name: 'a.ts',
  content: 'x',
  savedContent: 'x',
  language: 'typescript'
}

const baseProps = {
  openFiles: [file],
  activeFilePath: file.path,
  isDirty: false,
  isSaving: false,
  saveError: null as Error | null,
  onChangeContent: vi.fn(),
  onSave: vi.fn(),
  onActivateTab: vi.fn().mockReturnValue(true),
  onCloseTab: vi.fn(),
  onReorderTabs: vi.fn(),
  isExecuting: false,
  result: 'result text' as string | null,
  streamingText: '',
  executionError: null as Error | null,
  onClearResult: vi.fn(),
  onCancelExecution: vi.fn(),
  isOverlayOpen: false,
  openedFileSignal: { events: [] as OpenedFileEvent[] },
  diffTabs: [] as DiffTabKey[],
  activeDiffTab: null as DiffTabKey | null,
  onActivateDiffTab: vi.fn(),
  onCloseDiffTab: vi.fn(),
  onDeactivateDiffTab: vi.fn(),
  diffContent: null as string | null,
  diffStaged: false,
  diffError: null as Error | null,
  isHunkOperationInProgress: false,
  onStageHunk: vi.fn(),
  onUnstageHunk: vi.fn(),
  onDiscardHunk: vi.fn(),
  canDiscardHunk: false,
  isActiveFileUntracked: false,
  isActiveFileConflicted: false,
  conflictFile: makeConflictFileState(),
  isConflictBlocked: false,
  onEditorMount: vi.fn()
}

function makeAgentTerminal(isMaximized = false): AgentTerminalPanelState {
  return {
    sessions: makeAgentSessionsState(),
    sendingSlotId: null,
    activities: new Map(),
    layout: {
      isOpen: true,
      isMaximized,
      open: vi.fn(),
      toggleOpen: vi.fn(),
      toggleMaximized: vi.fn()
    }
  }
}

describe('EditorPanel: 下部のパネル', () => {
  it('既定(output)では出力パネルを出し、ターミナルパネルを出さない', () => {
    const { container } = render(<EditorPanel {...baseProps} />)
    expect(container.querySelector('.editor-panel__main')).toBeVisible()
    expect(screen.getByText('result text')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'エージェント' })).toBeNull()
  })

  it('agent-terminal ではターミナルパネルを出し、出力パネルを出さない', () => {
    render(
      <EditorPanel
        {...baseProps}
        bottomPanel="agent-terminal"
        agentTerminal={makeAgentTerminal()}
      />
    )
    expect(screen.getByRole('region', { name: 'エージェント' })).toBeInTheDocument()
    expect(screen.queryByText('result text')).toBeNull()
  })

  // agentChangesReview は省略可能な props のため、渡し忘れを型で検知できない(パターン 155)
  it('ターミナルパネルに「変更を確認」を渡す', () => {
    const onReview = vi.fn()
    render(
      <EditorPanel
        {...baseProps}
        bottomPanel="agent-terminal"
        agentTerminal={makeAgentTerminal()}
        agentChangesReview={{ isRecording: true, onReview }}
      />
    )
    screen.getByRole('button', { name: 'エージェントの変更を確認（ソース管理を開く）' }).click()
    expect(onReview).toHaveBeenCalledOnce()
  })

  it('none では下部に何も出さない(実行方式の読み込み中)', () => {
    render(<EditorPanel {...baseProps} bottomPanel="none" agentTerminal={makeAgentTerminal()} />)
    expect(screen.queryByRole('region', { name: 'エージェント' })).toBeNull()
    expect(screen.queryByText('result text')).toBeNull()
  })

  it('ターミナルパネルの最大化の間は、タブと本文を隠す', () => {
    const { container } = render(
      <EditorPanel
        {...baseProps}
        bottomPanel="agent-terminal"
        agentTerminal={makeAgentTerminal(true)}
      />
    )
    expect(container.querySelector('.editor-panel__main')).not.toBeVisible()
    expect(screen.getByRole('region', { name: 'エージェント' })).toBeVisible()
  })

  it('外部変更の通知があれば、タブの下に出す', () => {
    const { container } = render(
      <EditorPanel
        {...baseProps}
        externalChangeBanner={{
          path: file.path,
          kind: 'modified',
          reload: vi.fn(),
          dismiss: vi.fn()
        }}
      />
    )
    // 見た目の帯(読み上げは別のライブリージョン)
    expect(
      container.querySelector('.editor-panel__main .external-change-banner')
    ).toHaveTextContent('ディスク上のファイルが変更されました（エージェントなどによる変更）。')
  })

  // 文言ごと挿入されたライブリージョンは読み上げられないことがあるため、通知が無い間も空の領域を置いておく(パターン 87)。
  // ターミナルの最大化で隠れるタブと本文(.editor-panel__main)の外に置く
  it('外部変更の通知のライブリージョンを、タブと本文の外に通知が無い間も置き、通知が出たら同じ要素に文言を入れる', () => {
    const { container, rerender } = render(<EditorPanel {...baseProps} />)
    // ハンクを戻した結果の読み上げ(.agent-diff__live)も常設するため、外部変更のものをクラスで選ぶ
    const regions = container.querySelectorAll('.external-change-banner__live[aria-live="polite"]')
    expect(regions).toHaveLength(1)
    const region = regions[0]
    expect(region.closest('.editor-panel__main')).toBeNull()
    expect(region).toBeEmptyDOMElement()
    rerender(
      <EditorPanel
        {...baseProps}
        externalChangeBanner={{ path: file.path, kind: 'deleted', reload: null, dismiss: vi.fn() }}
      />
    )
    expect(container.querySelector('.external-change-banner__live')).toBe(region)
    expect(region).toHaveTextContent('ディスク上のファイルが削除されました。')
  })

  it('ターミナルの最大化の間も、外部変更の通知のライブリージョンは隠れない(読み上げられる)', () => {
    const banner = { path: file.path, kind: 'modified' as const, reload: vi.fn(), dismiss: vi.fn() }
    const { container } = render(
      <EditorPanel
        {...baseProps}
        bottomPanel="agent-terminal"
        agentTerminal={makeAgentTerminal(true)}
        externalChangeBanner={banner}
      />
    )
    expect(container.querySelector('.editor-panel__main')).not.toBeVisible()
    const region = container.querySelector('.external-change-banner__live[aria-live="polite"]')
    expect(region).toBeVisible()
    // ハンクを戻した結果の読み上げも、タブと本文の外に置くため最大化の間も隠れない
    const agentDiffRegion = container.querySelector('.agent-diff__live[aria-live="polite"]')
    expect(agentDiffRegion?.closest('.editor-panel__main')).toBeNull()
    expect(agentDiffRegion).toBeVisible()
    expect(region).toHaveTextContent(
      'ディスク上のファイルが変更されました（エージェントなどによる変更）。'
    )
  })
})
