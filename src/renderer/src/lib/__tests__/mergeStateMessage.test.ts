import { describe, it, expect } from 'vitest'
import { buildMergeBannerText, MERGE_ABORT_CONFIRM_MESSAGE } from '../mergeStateMessage'

describe('buildMergeBannerText', () => {
  it('未解決が 1 件以上なら件数を出す', () => {
    expect(buildMergeBannerText(3)).toBe('マージ中（未解決 3 件）')
    expect(buildMergeBannerText(1)).toBe('マージ中（未解決 1 件）')
  })

  it('未解決が 0 件ならマージを完了できることを伝える', () => {
    expect(buildMergeBannerText(0)).toBe('マージ中（すべて解決済み。マージを完了できます）')
  })
})

describe('MERGE_ABORT_CONFIRM_MESSAGE', () => {
  it('中止の確認文言が完全一致する', () => {
    expect(MERGE_ABORT_CONFIRM_MESSAGE).toBe(
      'マージを中止して、マージ前の状態に戻しますか？ 解決済みの内容も含め、マージ中の変更は破棄されます。'
    )
  })
})
