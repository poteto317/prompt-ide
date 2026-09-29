import type { GitFileStatus } from '@shared/types'
import { isUnstagedFile } from '../../lib/gitUtils'
import { alwaysUnlocked } from '../../hooks/useFileOperationLock'
import ChangesFileItem from './ChangesFileItem'

interface Props {
  files: GitFileStatus[]
  /** useGitOperations が「実行中」として持つパス集合。useGitOperations.ts の
   *  runStageOperation は対象パスに関わらず、この集合が空でない間は新規の
   *  stage/unstage を全てブロックする(同じ .git/index への同時書き込みを
   *  避けるため)。判定は stagingPaths.has(f.path)(このファイル自身)ではなく
   *  stagingPaths.size > 0(集合が空でないか)で行う必要がある。has(f.path) だけだと
   *  別ファイルが stagingPaths に入っている間もこのボタンは押せるように見え、
   *  押しても無言で弾かれるだけの状態になる */
  stagingPaths: ReadonlySet<string>
  onStage: (path: string) => void
  /** 取り消しボタン。確認・タブの同期は呼び出し元(useDiscardFileChanges)が行う */
  onDiscard: (path: string) => void
  onOpenDiff: (path: string) => void
  /** diff タブでのハンク操作(git apply --cached)と同じ .git/index への書き込みが
   *  対象ファイルに対して実行中かどうか。stagingPaths(このセクション自身の
   *  実行中状態)だけでは検知できない、別経路からの操作による競合を防ぐ */
  isLocked?: (path: string) => boolean
  /** 対象パスに関わらず、無関係な別ファイルの stage/unstage(useGitOperations)や
   *  ハンク操作(useDiffOperations)が実行中かどうか。useGitOperations.runStageOperation
   *  は対象パス単独の isLocked だけでなくこれも見て新規の stage をブロックするため、
   *  ボタン側もここを見ないと「押せそうに見えるのに押しても無言で弾かれる」状態になる */
  isAnyLocked?: () => boolean
}

export default function ChangesSection({
  files,
  stagingPaths,
  onStage,
  onDiscard,
  onOpenDiff,
  isLocked = alwaysUnlocked,
  isAnyLocked = alwaysUnlocked
}: Props): React.JSX.Element | null {
  const changed = files.filter(isUnstagedFile)
  if (changed.length === 0) return null
  return (
    <section className="source-control-panel__section">
      <h3 className="source-control-panel__section-title">変更 ({changed.length})</h3>
      <ul className="source-control-panel__file-list">
        {changed.map((f) => (
          <ChangesFileItem
            key={f.path}
            file={f}
            // 取り消しもステージと同じ直列化(useGitOperations.runStageOperation)で実行される
            // ため、ボタンの disabled 条件も共有する(パターン14)
            isOperationBlocked={stagingPaths.size > 0 || isLocked(f.path) || isAnyLocked()}
            onStage={onStage}
            onDiscard={onDiscard}
            onOpenDiff={onOpenDiff}
          />
        ))}
      </ul>
    </section>
  )
}
