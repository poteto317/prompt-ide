import { describe, it, expect, vi } from 'vitest'
import { buildAgentPromptRequest } from '../agentPromptRequest'
import type { PreparedAgentReferences } from '../agentReferenceCandidates'

const prepared: PreparedAgentReferences = {
  references: [{ path: 'src/app.ts', lineRange: '#L1-2' }],
  unsavedPaths: ['src/app.ts'],
  addedPaths: []
}

describe('buildAgentPromptRequest', () => {
  it('本文の末尾へ参照の一覧を足し、プロンプトの id・未保存の一覧・送れたときの知らせを options にする', () => {
    const onSent = vi.fn()
    const request = buildAgentPromptRequest('直して', 'p1', prepared, onSent)
    expect(request.text).toBe('直して\n\n参照:\n- @src/app.ts#L1-2')
    expect(request.options).toEqual({ promptId: 'p1', unsavedPaths: ['src/app.ts'], onSent })
  })

  it('未保存の一覧は写しと配列を共有しない', () => {
    const request = buildAgentPromptRequest('直して', 'p1', prepared, vi.fn())
    expect(request.options.unsavedPaths).not.toBe(prepared.unsavedPaths)
  })

  // 確認は options を浅くコピーして持つだけのため、同じ写しで続けて送っても依頼どうしで配列を共有しない
  it('同じ写しで続けて組み立てても、未保存の一覧は呼ぶたびに別の配列にする', () => {
    const first = buildAgentPromptRequest('一回目', 'p1', prepared, vi.fn())
    const second = buildAgentPromptRequest('二回目', 'p1', prepared, vi.fn())
    expect(second.options.unsavedPaths).toEqual(first.options.unsavedPaths)
    expect(second.options.unsavedPaths).not.toBe(first.options.unsavedPaths)
  })

  it('参照が無ければ本文のまま', () => {
    const request = buildAgentPromptRequest(
      '直して',
      'p1',
      { ...prepared, references: [] },
      vi.fn()
    )
    expect(request.text).toBe('直して')
  })
})
