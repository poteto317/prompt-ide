import NameInputDialog from '../explorer/NameInputDialog'

interface Props {
  /** 検証を通過した(trim 済みの)メッセージ。空文字のこともある(メッセージは任意) */
  onSubmit: (message: string) => void
  /** キャンセル・Escape・オーバーレイクリックのいずれでも呼ばれる */
  onCancel: () => void
}

// stash のメッセージの検証。メッセージは任意なので空を許可する。NUL は main 側が拒否する
// (spawn の引数に渡せない)ため、UX のためにここでも弾く。NameInputDialog は validate が
// 渡されたとき既定の「空は不可」の検証を使わない(CreateBranchDialog と同じ使い方)
function validateStashMessage(message: string): string | null {
  return message.includes('\0') ? 'メッセージに使用できない文字が含まれています' : null
}

// stash のメッセージ入力ダイアログ。入力 UI は NameInputDialog を流用し、ここでは検証を差し込むことだけを担う。
// 開閉状態とフォーカスの戻し先は呼び出し元(StashSection)の責務
export default function StashMessageDialog({ onSubmit, onCancel }: Props): React.JSX.Element {
  return (
    <NameInputDialog
      title="stash のメッセージ（任意）"
      inputLabel="stash のメッセージ"
      validate={validateStashMessage}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  )
}
