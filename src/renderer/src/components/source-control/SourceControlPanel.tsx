import type { GitStatusResult, GitFileStatus } from '@shared/types'

interface Props {
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  onRefresh: () => void
}

function statusChar(code: string): string {
  if (code === '?') return 'U'
  return code.trim() || '·'
}

function StagedSection({ files }: { files: GitFileStatus[] }) {
  const staged = files.filter((f) => f.index !== ' ' && f.index !== '?')
  if (staged.length === 0) return null
  return (
    <section className="source-control-panel__section">
      <h3 className="source-control-panel__section-title">ステージ済み ({staged.length})</h3>
      <ul className="source-control-panel__file-list">
        {staged.map((f) => (
          <li key={f.path} className="source-control-panel__file-item">
            <span className="source-control-panel__file-status source-control-panel__file-status--staged">
              {statusChar(f.index)}
            </span>
            <span className="source-control-panel__file-path">{f.path}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ChangesSection({ files }: { files: GitFileStatus[] }) {
  const changed = files.filter((f) => f.workingDir !== ' ' || f.index === '?')
  if (changed.length === 0) return null
  return (
    <section className="source-control-panel__section">
      <h3 className="source-control-panel__section-title">変更 ({changed.length})</h3>
      <ul className="source-control-panel__file-list">
        {changed.map((f) => (
          <li key={f.path} className="source-control-panel__file-item">
            <span className="source-control-panel__file-status source-control-panel__file-status--changed">
              {f.index === '?' ? 'U' : statusChar(f.workingDir)}
            </span>
            <span className="source-control-panel__file-path">{f.path}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function SourceControlPanel({ gitStatus, gitLoading, gitError, onRefresh }: Props) {
  return (
    <div className="source-control-panel">
      <div className="source-control-panel__toolbar">
        <button
          type="button"
          className="source-control-panel__refresh-btn"
          onClick={onRefresh}
          disabled={gitLoading}
          aria-label="更新"
        >
          更新
        </button>
      </div>
      {gitError && (
        <p className="source-control-panel__error">{gitError.message}</p>
      )}
      {gitLoading && (
        <p className="source-control-panel__loading">読み込み中...</p>
      )}
      {gitStatus !== null && !gitLoading && (
        !gitStatus.isRepo ? (
          <p className="source-control-panel__no-repo">Git リポジトリではありません</p>
        ) : (
          <>
            <div className="source-control-panel__branch">
              <span>{gitStatus.branch ?? '(no branch)'}</span>
              {gitStatus.ahead > 0 && (
                <span className="source-control-panel__ahead">↑{gitStatus.ahead}</span>
              )}
              {gitStatus.behind > 0 && (
                <span className="source-control-panel__behind">↓{gitStatus.behind}</span>
              )}
            </div>
            <StagedSection files={gitStatus.files} />
            <ChangesSection files={gitStatus.files} />
            {gitStatus.files.length === 0 && (
              <p className="source-control-panel__empty">変更はありません</p>
            )}
          </>
        )
      )}
      {gitStatus === null && !gitLoading && !gitError && (
        <p className="source-control-panel__placeholder">フォルダを開いてください</p>
      )}
    </div>
  )
}
