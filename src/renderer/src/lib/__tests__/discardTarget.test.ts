import { describe, it, expect } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import { movesToTrashOnDiscard, resolveDiscardTarget } from '../discardTarget'

describe('movesToTrashOnDiscard', () => {
  // main 側(gitService.discardFileChanges)と同じ分類。履歴に内容が無いものはゴミ箱へ
  it.each([
    ['未追跡', { path: 'new.txt', index: '?', workingDir: '?' }],
    ['intent-to-add', { path: 'ita.txt', index: ' ', workingDir: 'A' }]
  ] as const)('%s はゴミ箱へ移す', (_label, file) => {
    expect(movesToTrashOnDiscard(file)).toBe(true)
  })

  it.each([
    ['変更', { path: 'a.ts', index: ' ', workingDir: 'M' }],
    ['削除', { path: 'a.ts', index: ' ', workingDir: 'D' }],
    ['ステージ済み + 変更', { path: 'a.ts', index: 'M', workingDir: 'M' }],
    ['新規ステージ + 変更', { path: 'a.ts', index: 'A', workingDir: 'M' }]
  ] as const)('%s は index の内容へ戻す(ゴミ箱へ移さない)', (_label, file) => {
    expect(movesToTrashOnDiscard(file)).toBe(false)
  })
})

describe('resolveDiscardTarget', () => {
  const files: GitFileStatus[] = [
    { path: 'src/a.ts', index: ' ', workingDir: 'M' },
    { path: 'new.txt', index: '?', workingDir: '?' },
    { path: 'ita.txt', index: ' ', workingDir: 'A' },
    // git rm --cached 直後は同じパスが 'D '(ステージ済み)と '??'(未ステージ)の 2 件で現れる
    { path: 't.txt', index: 'D', workingDir: ' ' },
    { path: 't.txt', index: '?', workingDir: '?' }
  ]

  it('リポジトリ相対パスを開いているフォルダ基準の絶対パスにする', () => {
    expect(resolveDiscardTarget({ folderPath: '/project', files, path: 'src/a.ts' })).toEqual({
      absolutePath: '/project/src/a.ts',
      movesToTrash: false
    })
  })

  it('未追跡はゴミ箱へ移す対象として解決する', () => {
    expect(resolveDiscardTarget({ folderPath: '/project', files, path: 'new.txt' })).toEqual({
      absolutePath: '/project/new.txt',
      movesToTrash: true
    })
  })

  // 判定に movesToTrashOnDiscard を使っていること(未追跡だけでなく intent-to-add も
  // ゴミ箱へ移す対象になること)を固定する。main 側の分類と食い違うと、履歴の無い内容を
  // 「元に戻せません」の文言のまま扱い、タブも閉じずに再読込してしまう
  it('intent-to-add もゴミ箱へ移す対象として解決する', () => {
    expect(resolveDiscardTarget({ folderPath: '/project', files, path: 'ita.txt' })).toEqual({
      absolutePath: '/project/ita.txt',
      movesToTrash: true
    })
  })

  // 取り消しボタンは「変更」(未ステージ)の行にしか無いため、未ステージのエントリで判定する
  it('同じパスが複数ある場合は未ステージのエントリで判定する', () => {
    expect(
      resolveDiscardTarget({ folderPath: '/project', files, path: 't.txt' })?.movesToTrash
    ).toBe(true)
  })

  it('フォルダが開かれていなければ null', () => {
    expect(resolveDiscardTarget({ folderPath: null, files, path: 'src/a.ts' })).toBeNull()
  })

  // status の再取得とのずれで一覧に無い場合は、ゴミ箱への移動ではなく追跡済みとして扱う
  // (main 側が実際の状態で判定し直すため、ここは確認文言とタブの扱いにだけ影響する)
  it('一覧に無いパスは追跡済みとして扱う', () => {
    expect(resolveDiscardTarget({ folderPath: '/project', files, path: 'gone.ts' })).toEqual({
      absolutePath: '/project/gone.ts',
      movesToTrash: false
    })
  })

  it('Windows のフォルダでは区切り文字をフォルダ側に合わせてつなぐ', () => {
    expect(
      resolveDiscardTarget({ folderPath: 'C:\\project', files, path: 'src/a.ts' })?.absolutePath
    ).toBe('C:\\project\\src/a.ts')
  })
})
