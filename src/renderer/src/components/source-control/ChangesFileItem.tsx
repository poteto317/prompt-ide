import type { GitFileStatus } from '@shared/types'
import { statusChar, isUntrackedFile, isConflictedFile } from '../../lib/gitUtils'

interface Props {
  file: GitFileStatus
  /** ステージ・取り消しを実行できない状態か。取り消しもステージと同じ直列化
   *  (useGitOperations.runStageOperation)で実行されるため、両ボタンで同じ条件を使う
   *  (判定は呼び出し元の ChangesSection が行う) */
  isOperationBlocked: boolean
  onStage: (path: string) => void
  /** 確認・タブの同期は呼び出し元(useDiscardFileChanges)が行う */
  onDiscard: (path: string) => void
  onOpenDiff: (path: string) => void
}

// 「変更」セクションの 1 行(ステータス・差分を開くパス・取り消し/ステージボタン)。
// 一覧の絞り込み・見出しと、実行可否の判定は ChangesSection の責務で、ここでは 1 ファイル分の
// 表示と操作だけを担う
export default function ChangesFileItem({
  file,
  isOperationBlocked,
  onStage,
  onDiscard,
  onOpenDiff
}: Props): React.JSX.Element {
  return (
    <li className="source-control-panel__file-item">
      <span className="source-control-panel__file-status source-control-panel__file-status--changed">
        {isUntrackedFile(file) ? statusChar(file.index) : statusChar(file.workingDir)}
      </span>
      <button
        type="button"
        className="source-control-panel__file-path"
        onClick={() => onOpenDiff(file.path)}
        aria-label={`${file.path} の未ステージ差分を表示`}
      >
        {file.path}
      </button>
      <div className="source-control-panel__file-actions">
        {/* 取り消しもステージも main 側が ls-files -u で拒否するが、押せるのに必ず失敗するボタンは
            出さない。+ (git add) はマーカー入りのまま解決済みにしてしまうため、コンフリクト中の
            ファイルはパスを押して開く解決ビューの「解決済みにする」(マーカーを検査する)へ誘導する */}
        {!isConflictedFile(file) && (
          <>
            <button
              type="button"
              className="source-control-panel__discard-btn"
              onClick={() => onDiscard(file.path)}
              disabled={isOperationBlocked}
              aria-label={`${file.path} の変更を取り消し`}
            >
              ↶
            </button>
            <button
              type="button"
              className="source-control-panel__stage-btn"
              onClick={() => onStage(file.path)}
              disabled={isOperationBlocked}
              aria-label={`${file.path} をステージ`}
            >
              +
            </button>
          </>
        )}
      </div>
    </li>
  )
}
