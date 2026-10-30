import type { GitFileStatus } from '@shared/types'
import { statusChar, isStagedFile } from '../../lib/gitUtils'
import { alwaysUnlocked } from '../../hooks/useFileOperationLock'
import CollapsibleSection from './CollapsibleSection'
import GitFileRow from './GitFileRow'

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
  onUnstage: (path: string, renamedFrom?: string) => void
  onOpenDiff: (path: string) => void
  /** diff タブでのハンク操作(git apply --cached)と同じ .git/index への書き込みが
   *  対象ファイルに対して実行中かどうか。stagingPaths(このセクション自身の
   *  実行中状態)だけでは検知できない、別経路からの操作による競合を防ぐ */
  isLocked?: (path: string) => boolean
  /** 対象パスに関わらず、無関係な別ファイルの stage/unstage(useGitOperations)や
   *  ハンク操作(useDiffOperations)が実行中かどうか。useGitOperations.runStageOperation
   *  は対象パス単独の isLocked だけでなくこれも見て新規の stage/unstage をブロックする
   *  ため、ボタン側もここを見ないと「押せそうに見えるのに押しても無言で弾かれる」
   *  状態になる */
  isAnyLocked?: () => boolean
}

export default function StagedSection({
  files,
  stagingPaths,
  onUnstage,
  onOpenDiff,
  isLocked = alwaysUnlocked,
  isAnyLocked = alwaysUnlocked
}: Props): React.JSX.Element | null {
  const staged = files.filter(isStagedFile)
  if (staged.length === 0) return null
  return (
    <CollapsibleSection title="ステージされている変更" count={staged.length}>
      <ul className="source-control-panel__file-list">
        {staged.map((f) => (
          <GitFileRow
            key={f.path}
            file={f}
            statusLetter={statusChar(f.index)}
            openLabel={`${f.path} のステージ済み差分を表示`}
            onOpenDiff={() => onOpenDiff(f.path)}
          >
            <button
              type="button"
              className="source-control-panel__unstage-btn"
              onClick={() => onUnstage(f.path, f.from)}
              disabled={stagingPaths.size > 0 || isLocked(f.path) || isAnyLocked()}
              aria-label={`${f.path} をアンステージ`}
            >
              −
            </button>
          </GitFileRow>
        ))}
      </ul>
    </CollapsibleSection>
  )
}
