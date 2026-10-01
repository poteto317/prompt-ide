import { describe, it, expect } from 'vitest'
import {
  buildDiscardAllConfirmMessage,
  buildDiscardConfirmMessage,
  buildDiscardHunkConfirmMessage
} from '../discardConfirmMessage'

describe('buildDiscardConfirmMessage', () => {
  it('追跡済みは「元に戻せません」と伝える', () => {
    expect(
      buildDiscardConfirmMessage({ path: 'src/a.ts', movesToTrash: false, hasUnsavedEdits: false })
    ).toBe('src/a.ts の変更を取り消しますか？この操作は元に戻せません。')
  })

  it('未追跡はゴミ箱へ移動すると伝える', () => {
    expect(
      buildDiscardConfirmMessage({ path: 'new.txt', movesToTrash: true, hasUnsavedEdits: false })
    ).toBe('new.txt をゴミ箱へ移動しますか？')
  })

  // status は untracked-files=all のため、'/' で終わるパスはネストした git リポジトリだけ。
  // その .git(未 push のコミットを含む)ごと移動することを伝える(最終レビューで追加)
  it('末尾が / のパスはフォルダとその中身がすべて移動すると伝える', () => {
    expect(
      buildDiscardConfirmMessage({ path: 'sub/', movesToTrash: true, hasUnsavedEdits: false })
    ).toBe('sub/ をゴミ箱へ移動しますか？フォルダとその中身がすべて移動します。')
  })

  it('末尾が / のパスでも未保存の編集の追記は保つ', () => {
    expect(
      buildDiscardConfirmMessage({ path: 'sub/', movesToTrash: true, hasUnsavedEdits: true })
    ).toBe(
      'sub/ をゴミ箱へ移動しますか？フォルダとその中身がすべて移動します。\n\nエディタの未保存の編集も破棄されます。'
    )
  })

  it.each([false, true])(
    '未保存の編集がある場合はエディタの編集も破棄されることを追記する(movesToTrash=%s)',
    (movesToTrash) => {
      const message = buildDiscardConfirmMessage({
        path: 'a.ts',
        movesToTrash,
        hasUnsavedEdits: true
      })
      expect(message.endsWith('\n\nエディタの未保存の編集も破棄されます。')).toBe(true)
    }
  )
})

describe('buildDiscardHunkConfirmMessage', () => {
  it('パスとハンクの見出しを示し、元に戻せないと伝える', () => {
    expect(
      buildDiscardHunkConfirmMessage({
        path: 'src/a.ts',
        hunkHeader: '@@ -1,3 +1,4 @@',
        hasUnsavedEdits: false
      })
    ).toBe('src/a.ts の次のハンクを取り消しますか？この操作は元に戻せません。\n\n@@ -1,3 +1,4 @@')
  })

  it('未保存の編集があるときは末尾に破棄も伝える', () => {
    expect(
      buildDiscardHunkConfirmMessage({
        path: 'src/a.ts',
        hunkHeader: '@@ -1,3 +1,4 @@',
        hasUnsavedEdits: true
      })
    ).toBe(
      'src/a.ts の次のハンクを取り消しますか？この操作は元に戻せません。\n\n@@ -1,3 +1,4 @@\n\nエディタの未保存の編集も破棄されます。'
    )
  })
})

describe('buildDiscardAllConfirmMessage', () => {
  it('ゴミ箱へ移すものがなければ件数と元に戻せないことだけを伝える', () => {
    expect(buildDiscardAllConfirmMessage({ count: 3, trashCount: 0 })).toBe(
      '変更 3 件を取り消しますか？この操作は元に戻せません。'
    )
  })

  it('ゴミ箱へ移す未追跡ファイルがあるときは件数を追記する', () => {
    expect(buildDiscardAllConfirmMessage({ count: 5, trashCount: 2 })).toBe(
      '変更 5 件を取り消しますか？この操作は元に戻せません。\nうち 2 件の未追跡ファイルはゴミ箱へ移動します。'
    )
  })
})
