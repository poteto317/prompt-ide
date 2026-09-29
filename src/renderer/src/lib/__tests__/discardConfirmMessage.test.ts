import { describe, it, expect } from 'vitest'
import { buildDiscardConfirmMessage } from '../discardConfirmMessage'

describe('buildDiscardConfirmMessage', () => {
  it('追跡済みは「元に戻せません」と伝える', () => {
    expect(
      buildDiscardConfirmMessage({ path: 'src/a.ts', isUntracked: false, hasUnsavedEdits: false })
    ).toBe('src/a.ts の変更を取り消しますか？この操作は元に戻せません。')
  })

  it('未追跡はゴミ箱へ移動すると伝える', () => {
    expect(
      buildDiscardConfirmMessage({ path: 'new.txt', isUntracked: true, hasUnsavedEdits: false })
    ).toBe('new.txt をゴミ箱へ移動しますか？')
  })

  // status は untracked-files=all のため、'/' で終わるパスはネストした git リポジトリだけ。
  // その .git(未 push のコミットを含む)ごと移動することを伝える(最終レビューで追加)
  it('末尾が / のパスはフォルダとその中身がすべて移動すると伝える', () => {
    expect(
      buildDiscardConfirmMessage({ path: 'sub/', isUntracked: true, hasUnsavedEdits: false })
    ).toBe('sub/ をゴミ箱へ移動しますか？フォルダとその中身がすべて移動します。')
  })

  it('末尾が / のパスでも未保存の編集の追記は保つ', () => {
    expect(
      buildDiscardConfirmMessage({ path: 'sub/', isUntracked: true, hasUnsavedEdits: true })
    ).toBe(
      'sub/ をゴミ箱へ移動しますか？フォルダとその中身がすべて移動します。\n\nエディタの未保存の編集も破棄されます。'
    )
  })

  it.each([false, true])(
    '未保存の編集がある場合はエディタの編集も破棄されることを追記する(未追跡=%s)',
    (isUntracked) => {
      const message = buildDiscardConfirmMessage({
        path: 'a.ts',
        isUntracked,
        hasUnsavedEdits: true
      })
      expect(message.endsWith('\n\nエディタの未保存の編集も破棄されます。')).toBe(true)
    }
  )
})
