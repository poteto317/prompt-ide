import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ソース管理のメニューのテスト用の操作(ツールバーの「…」のプル・プッシュ・フェッチ、コミットボタンの矢印の amend。
// どちらもメニューの中にある。1 か所から使う)

/** ツールバーの「…」のボタン */
export function sourceControlMenuButton(): HTMLElement {
  return screen.getByRole('button', { name: 'その他の操作' })
}

/** 「…」を開く */
export async function openSourceControlMenu(): Promise<void> {
  await userEvent.click(sourceControlMenuButton())
}

/** 「…」を開いて項目を押す */
export async function selectSourceControlMenuItem(name: string): Promise<void> {
  await openSourceControlMenu()
  await userEvent.click(screen.getByRole('menuitem', { name }))
}

/** コミットボタンの矢印のボタン */
export function commitMenuButton(): HTMLElement {
  return screen.getByRole('button', { name: 'コミットのオプション' })
}

/** 矢印のボタンを開いて amend を切り替える */
export async function toggleAmend(): Promise<void> {
  await userEvent.click(commitMenuButton())
  await userEvent.click(
    screen.getByRole('menuitemcheckbox', { name: '前回のコミットを修正 (amend)' })
  )
}
