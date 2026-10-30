import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { isActivationKey } from '../../lib/activationKey'

interface Props {
  path: string
  fileName: string
  isDirty: boolean
  isActive: boolean
  onActivate: () => void
  onClose: () => void
  /** 閉じるボタンを表示するか。既定は true。WelcomeView のプレースホルダタブは
   * 閉じる操作を持たないため false を渡し、押しても何も起きないボタンを見せない */
  closable?: boolean
  /** ドラッグでの並び替え対象か。既定は true。false のタブ(diff タブ)は
   * ドラッグ自体を無効化する。有効なままにすると、ドラッグはできるのに
   * 並び替えの実体(実ファイルタブの配列)には反映されず、タブが元位置へ
   * 戻るだけでフィードバックが無い状態になる */
  isReorderable?: boolean
}

export default function EditorTab({
  path,
  fileName,
  isDirty,
  isActive,
  onActivate,
  onClose,
  closable = true,
  isReorderable = true
}: Props): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: path,
    disabled: !isReorderable
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (isActivationKey(e.key)) {
      if (e.key === ' ') {
        e.preventDefault()
      }
      onActivate()
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      // 並び替え対象外のタブには dnd-kit の属性・リスナーを付けない。
      // useSortable の disabled だけではドラッグ起動は止まるものの、
      // role="button" 等の属性が残り、支援技術にはドラッグ可能な要素として
      // 見え続けてしまう
      {...(isReorderable ? attributes : {})}
      {...(isReorderable ? listeners : {})}
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      className={`editor-tab${isActive ? ' editor-tab--active' : ''}`}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
    >
      {fileName}
      {isDirty && (
        <span className="editor-tab__dirty-dot" role="img" aria-label="未保存の変更があります">
          ●
        </span>
      )}
      {closable && (
        <button
          type="button"
          className="editor-tab__close-btn"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-label="タブを閉じる"
        >
          ×
        </button>
      )}
    </div>
  )
}
