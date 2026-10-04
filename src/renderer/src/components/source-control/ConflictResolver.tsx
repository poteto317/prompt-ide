import { useEffect, useRef, useState } from 'react'
import type { ConflictChoice, ConflictFile, ConflictUnparsableReason } from '@shared/types'
import type { ConflictFileState } from '../../hooks/useConflictFile'
import { getConflictActions } from '../../lib/conflictActions'
import type { ConflictActions } from '../../lib/conflictActions'
import { CHOICE_TARGET } from '../../lib/conflictChoice'
import { toAnnouncementText } from '../../lib/announcementText'
import ConflictBlock from './ConflictBlock'
import ConflictLines from './ConflictLines'

interface Props {
  conflict: ConflictFileState
  /** 他の操作中(ステージ・ハンク操作・commit・pull・ブランチ操作・退避・マージの完了/中止)で、
   *  押しても no-op になる状態。全ボタンを disabled にする */
  isBlocked: boolean
}

// reason は「なぜブロックを選べないか」の説明にだけ使う。行動の案内は、実際に出るボタンに合わせて
// stages(ステージ 2・3 の有無)から決める
const UNPARSABLE_REASONS: Record<ConflictUnparsableReason, string> = {
  markers: 'コンフリクトのマーカーを解析できません',
  binary: 'バイナリのコンフリクトです',
  'not-regular': '通常のファイルではないため、ブロックを選べません',
  missing: 'ファイルが作業ツリーにありません',
  submodule: 'サブモジュールのコンフリクトです'
}

function unparsableMessage(
  reason: ConflictUnparsableReason,
  actions: ConflictActions,
  stages: ConflictFile['stages']
): string {
  // サブモジュールは解決のボタンを出さない(getConflictActions)。アプリの操作では解決できないため、ターミナルへ案内する
  if (reason === 'submodule') {
    const base = `${UNPARSABLE_REASONS[reason]}。サブモジュールの中で採用するコミットを選んでから、ターミナルで git add して解決してください`
    // 片側が削除したときは、残すなら git add、削除するなら git rm(git add だと .gitmodules から消えたまま gitlink が残る)
    return stages.ours !== stages.theirs ? `${base}（削除する場合は git rm）` : base
  }
  // バイナリ・リンクは「すべて採用」(checkout)だけでは未解決のまま残るため、続けて「解決済みにする」を案内する
  // (markers は手編集の案内が別にあり、missing では「解決済みにする」が出ない)
  const thenResolve = reason !== 'markers' && actions.markResolved
  const sideAction = actions.wholeFile
    ? thenResolve
      ? '「自分をすべて採用」か「相手をすべて採用」を選んでから、「解決済みにする」を押してください'
      : '「自分をすべて採用」か「相手をすべて採用」を選んでください'
    : actions.keep
      ? '「ファイルを残す」か「削除する」を選んでください'
      : '「削除する」を選んでください'
  const action =
    reason === 'markers'
      ? actions.wholeFile
        ? 'エディタで直接編集してください'
        : `エディタで直接編集するか、${sideAction}`
      : sideAction
  return `${UNPARSABLE_REASONS[reason]}。${action}`
}

// 未解決ファイルの解決ビュー(diff タブの中身)。表示するのはファイルの内容(テキストとブロックの並び)と
// 操作の入口だけで、実行・排他・確認は useConflictFile の責務。実行中・他の操作中は全ボタンを disabled にする。
// key は並びの位置(同じ内容のテキストやブロックが並びうるため、内容や文言は使わない)。
// ブロックを選ぶと、ファイルが書き換わってそのブロックはビューから消える。結果は role="status" で
// 読み上げ、フォーカスは次のブロック(無ければツールバー)の先頭のボタンへ移す
export default function ConflictResolver({ conflict, isBlocked }: Props): React.JSX.Element {
  const { file, isLoading, error, pendingOperation } = conflict
  const disabled = pendingOperation !== null || isBlocked
  const rootRef = useRef<HTMLDivElement>(null)
  // 選択の成功ごとに id を進める(同じ文言が続いても effect と live region が更新されるように)
  const [announcement, setAnnouncement] = useState({ text: '', id: 0 })
  // 選択に成功したブロックの 0 始まりの番号。announcement の反映(=読み直しの描画後)にフォーカスを移す
  const focusIndexRef = useRef<number | null>(null)

  useEffect(() => {
    const index = focusIndexRef.current
    if (index === null || rootRef.current === null) return
    focusIndexRef.current = null
    // 選んだブロックが消えているので、同じ番号のブロックが「次のブロック」。無ければ「解決済みにする」
    // (ツールバーの先頭は確認なしで全体を上書きする「すべて採用」なので、連打で上書きしないよう避ける)
    const nextBlock = rootRef.current.querySelectorAll('.conflict-block')[index]
    const target =
      nextBlock?.querySelector<HTMLButtonElement>('button:not(:disabled)') ??
      rootRef.current.querySelector<HTMLButtonElement>(
        '.conflict-resolver__toolbar button[aria-label="解決済みにする"]:not(:disabled)'
      ) ??
      rootRef.current.querySelector<HTMLButtonElement>(
        '.conflict-resolver__toolbar button:not(:disabled)'
      )
    target?.focus()
  }, [announcement.id])

  const handleChoose = async (blockIndex: number, choice: ConflictChoice): Promise<void> => {
    const applied = await conflict.chooseBlock(blockIndex, choice)
    if (!applied) return
    focusIndexRef.current = blockIndex
    setAnnouncement((prev) => ({
      text: `ブロック ${blockIndex + 1} を${CHOICE_TARGET[choice]}しました`,
      id: prev.id + 1
    }))
  }

  // ブロック番号は、コンフリクトのセグメントだけを数えた 0 始まりの通し番号(digests の順と同じ)
  let blockCount = 0
  const body =
    file !== null && file.status === 'parsed'
      ? file.segments.map((segment, segmentIndex) => {
          if (segment.kind === 'text') {
            return (
              <div key={segmentIndex} className="conflict-resolver__text">
                <ConflictLines lines={segment.lines} className="diff-view__line--context" />
              </div>
            )
          }
          const blockIndex = blockCount++
          return (
            <ConflictBlock
              key={segmentIndex}
              index={blockIndex}
              segment={segment}
              disabled={disabled}
              onChoose={(choice) => void handleChoose(blockIndex, choice)}
            />
          )
        })
      : null
  const hasBlocks = blockCount > 0
  const actions = file !== null ? getConflictActions(file) : null

  return (
    <div className="conflict-resolver" ref={rootRef}>
      <p className="conflict-resolver__status" role="status">
        {/* 同じ文言が続いても読み上げが再実行されるよう、文字列を変える */}
        {toAnnouncementText(announcement)}
      </p>
      {error !== null && (
        <p className="conflict-resolver__error" role="alert">
          {error.message}
        </p>
      )}
      {file === null && isLoading && <p className="conflict-resolver__loading">読み込み中...</p>}
      {file !== null && (
        <div className="conflict-resolver__toolbar">
          {actions?.wholeFile && (
            <>
              <button
                type="button"
                className="conflict-resolver__button"
                aria-label="自分をすべて採用"
                disabled={disabled}
                onClick={() => void conflict.resolveWholeFile('ours')}
              >
                自分をすべて採用
              </button>
              <button
                type="button"
                className="conflict-resolver__button"
                aria-label="相手をすべて採用"
                disabled={disabled}
                onClick={() => void conflict.resolveWholeFile('theirs')}
              >
                相手をすべて採用
              </button>
            </>
          )}
          {actions?.remove && (
            <>
              {actions.keep && (
                <button
                  type="button"
                  className="conflict-resolver__button"
                  aria-label="ファイルを残す"
                  disabled={disabled}
                  onClick={() => void conflict.keepFile()}
                >
                  ファイルを残す
                </button>
              )}
              <button
                type="button"
                className="conflict-resolver__button conflict-resolver__button--danger"
                aria-label="削除する"
                disabled={disabled}
                onClick={() => void conflict.removeFile()}
              >
                削除する
              </button>
            </>
          )}
          {actions?.markResolved && (
            <button
              type="button"
              className="conflict-resolver__button conflict-resolver__button--primary"
              aria-label="解決済みにする"
              disabled={disabled || hasBlocks}
              onClick={() => void conflict.markResolved()}
            >
              解決済みにする
            </button>
          )}
        </div>
      )}
      {file !== null && actions !== null && file.status === 'unparsable' && (
        <p className="conflict-resolver__notice">
          {unparsableMessage(file.reason, actions, file.stages)}
        </p>
      )}
      {body}
    </div>
  )
}
