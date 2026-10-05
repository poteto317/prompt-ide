import { describe, it, expect } from 'vitest'
import { decideExternalChange } from '../externalChangeDecision'
import type { ExternalChangeDecision, NotifiedDisk } from '../externalChangeDecision'

const clean = { content: 'saved', savedContent: 'saved' }
const dirty = { content: 'editing', savedContent: 'saved' }

describe('decideExternalChange', () => {
  it('読む間にタブが閉じられたら gone', () => {
    expect(
      decideExternalChange({ before: clean, after: null, disk: 'disk', dismissed: undefined })
    ).toEqual({ kind: 'gone' })
  })

  it('読む間に savedContent が変わったら(保存が挟まった) retry', () => {
    expect(
      decideExternalChange({
        before: clean,
        after: { savedContent: 'saved again' },
        disk: 'saved again',
        dismissed: undefined
      })
    ).toEqual({ kind: 'retry' })
  })

  it.each([
    ['未編集', clean],
    ['編集中', dirty]
  ])('ディスクが savedContent と同じなら in-sync(%s)', (_label, before) => {
    expect(
      decideExternalChange({
        before,
        after: { savedContent: 'saved' },
        disk: 'saved',
        // 消した覚えがあっても in-sync が先(覚えを捨てる)
        dismissed: { disk: 'other', savedContent: 'saved' }
      })
    ).toEqual({ kind: 'in-sync' })
  })

  it('未編集で内容が違えば replace-clean(置き換えられないときは modified の印)', () => {
    expect(
      decideExternalChange({
        before: clean,
        after: { savedContent: 'saved' },
        disk: 'disk',
        dismissed: undefined
      })
    ).toEqual<ExternalChangeDecision>({
      kind: 'replace-clean',
      expected: { content: 'saved', savedContent: 'saved' },
      otherwise: {
        kind: 'mark',
        mark: 'modified',
        notified: { disk: 'disk', savedContent: 'saved' }
      }
    })
  })

  it('未編集でディスクから消えたら replace-clean(置き換えられないときは deleted の印)', () => {
    expect(
      decideExternalChange({
        before: clean,
        after: { savedContent: 'saved' },
        disk: null,
        dismissed: undefined
      })
    ).toEqual<ExternalChangeDecision>({
      kind: 'replace-clean',
      expected: { content: 'saved', savedContent: 'saved' },
      otherwise: { kind: 'mark', mark: 'deleted', notified: { disk: null, savedContent: 'saved' } }
    })
  })

  it('未編集でも消した変更と同じなら、置き換えられないときは suppressed', () => {
    const decision = decideExternalChange({
      before: clean,
      after: { savedContent: 'saved' },
      disk: 'disk',
      dismissed: { disk: 'disk', savedContent: 'saved' }
    })
    expect(decision).toEqual({
      kind: 'replace-clean',
      expected: { content: 'saved', savedContent: 'saved' },
      otherwise: { kind: 'suppressed' }
    })
  })

  it('編集中は置き換えず modified の印(編集中のタブを自動で上書きしない)', () => {
    expect(
      decideExternalChange({
        before: dirty,
        after: { savedContent: 'saved' },
        disk: 'disk',
        dismissed: undefined
      })
    ).toEqual({
      kind: 'mark',
      mark: 'modified',
      notified: { disk: 'disk', savedContent: 'saved' }
    })
  })

  it('編集中にディスクから消えたら deleted の印', () => {
    expect(
      decideExternalChange({
        before: dirty,
        after: { savedContent: 'saved' },
        disk: null,
        dismissed: undefined
      })
    ).toEqual({ kind: 'mark', mark: 'deleted', notified: { disk: null, savedContent: 'saved' } })
  })

  it('消した変更と同じディスクの内容・savedContent なら suppressed(知らせ直さない)', () => {
    expect(
      decideExternalChange({
        before: dirty,
        after: { savedContent: 'saved' },
        disk: 'disk',
        dismissed: { disk: 'disk', savedContent: 'saved' }
      })
    ).toEqual({ kind: 'suppressed' })
  })

  it('消した変更が削除(null)で、いまも削除なら suppressed', () => {
    expect(
      decideExternalChange({
        before: dirty,
        after: { savedContent: 'saved' },
        disk: null,
        dismissed: { disk: null, savedContent: 'saved' }
      })
    ).toEqual({ kind: 'suppressed' })
  })

  it.each<[string, NotifiedDisk]>([
    ['ディスクの内容が変わった', { disk: 'older disk', savedContent: 'saved' }],
    ['savedContent が変わった', { disk: 'disk', savedContent: 'older saved' }]
  ])('消した変更と違えば(%s)知らせ直す', (_label, dismissed) => {
    expect(
      decideExternalChange({
        before: dirty,
        after: { savedContent: 'saved' },
        disk: 'disk',
        dismissed
      })
    ).toEqual({ kind: 'mark', mark: 'modified', notified: { disk: 'disk', savedContent: 'saved' } })
  })
})
