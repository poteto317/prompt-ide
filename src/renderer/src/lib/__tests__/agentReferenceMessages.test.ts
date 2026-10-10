import { describe, it, expect } from 'vitest'
import {
  formatAgentReferenceAddedAnnouncement,
  formatAgentReferenceAlreadyAddedAnnouncement,
  formatAgentReferenceRemoveLabel,
  formatAgentUnsavedNotice
} from '../agentReferenceMessages'

describe('formatAgentReferenceAddedAnnouncement', () => {
  it('足した参照を読み上げの文に埋め込む', () => {
    expect(formatAgentReferenceAddedAnnouncement('@docs/notes.md')).toBe(
      '参照に @docs/notes.md を足しました'
    )
  })
})

describe('formatAgentReferenceAlreadyAddedAnnouncement', () => {
  it('すでに足してある参照を読み上げの文に埋め込む', () => {
    expect(formatAgentReferenceAlreadyAddedAnnouncement('@docs/notes.md')).toBe(
      '@docs/notes.md はすでに参照にあります'
    )
  })
})

describe('formatAgentReferenceRemoveLabel', () => {
  it('外すボタンの名前に参照を埋め込む', () => {
    expect(formatAgentReferenceRemoveLabel('@docs/notes.md')).toBe('@docs/notes.md を参照から外す')
  })
})

describe('formatAgentUnsavedNotice', () => {
  it('複数のパスを「、」で区切って並べる', () => {
    expect(formatAgentUnsavedNotice(['src/app.ts', 'docs/a.md'])).toBe(
      '未保存の変更があるファイルは、保存するまで claude に見えません: src/app.ts、docs/a.md'
    )
  })

  it('1 つだけのときは区切りを入れない', () => {
    expect(formatAgentUnsavedNotice(['src/app.ts'])).toBe(
      '未保存の変更があるファイルは、保存するまで claude に見えません: src/app.ts'
    )
  })
})
