import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AgentSendFeedbackAnnouncer from '../AgentSendFeedbackAnnouncer'
import { AGENT_SEND_FAILURE_MESSAGES, AGENT_SENT_NOTICE } from '../../../lib/agentSendMessages'

// 送信の結果の読み上げの領域(Sidebar がパネルの外に常に置く 1 か所)。見える文字(AgentSendFeedbackMessages)は aria-hidden なので、
// 読み上げの中身はここで確かめる

describe('AgentSendFeedbackAnnouncer', () => {
  it('成功の通知を role="status" に入れる', () => {
    render(
      <AgentSendFeedbackAnnouncer
        feedback={{ error: null, notice: { id: 1, text: AGENT_SENT_NOTICE } }}
      />
    )
    expect(screen.getByRole('status').textContent).toBe(AGENT_SENT_NOTICE)
  })

  it('同じ文言の成功が続いても、id が変われば status の文字列が変わる(読み上げ直す。パターン 87 の toAnnouncementText)', () => {
    const { rerender } = render(
      <AgentSendFeedbackAnnouncer
        feedback={{ error: null, notice: { id: 1, text: AGENT_SENT_NOTICE } }}
      />
    )
    const status = screen.getByRole('status')
    const first = status.textContent
    rerender(
      <AgentSendFeedbackAnnouncer
        feedback={{ error: null, notice: { id: 2, text: AGENT_SENT_NOTICE } }}
      />
    )
    // 要素は作り直さず(ライブリージョンは先に在る必要がある)、文字列だけが変わる
    expect(screen.getByRole('status')).toBe(status)
    expect(status.textContent).not.toBe(first)
    expect(status.textContent).toBe(`${AGENT_SENT_NOTICE}\u200b`)
  })

  it('失敗があるときだけ role="alert" にその文言を出す', () => {
    const message = AGENT_SEND_FAILURE_MESSAGES['input-not-found']
    const { rerender } = render(
      <AgentSendFeedbackAnnouncer feedback={{ error: message, notice: null }} />
    )
    expect(screen.getByRole('alert').textContent).toBe(message)
    rerender(<AgentSendFeedbackAnnouncer feedback={{ error: null, notice: null }} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('失敗も成功も無いときは alert を置かず、status は空のまま DOM に残す', () => {
    render(<AgentSendFeedbackAnnouncer feedback={{ error: null, notice: null }} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('')
  })
})
