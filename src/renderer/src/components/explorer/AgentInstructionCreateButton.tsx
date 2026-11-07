// 指示ファイルの節の `作成`(このフォルダ・全体で共通)。clone 中は押す前から押せないので disabled、作成の途中は押した結果
// として起きる状態なので aria-disabled にして押しても何もしない(disabled にするとフォーカスが body に落ちる。L-157)
interface Props {
  /** aria-label に入れるパス(このフォルダは相対パス、全体は ~/… の形) */
  path: string
  isBlocked: boolean
  isCreating: boolean
  onCreate: () => void
}

export default function AgentInstructionCreateButton({
  path,
  isBlocked,
  isCreating,
  onCreate
}: Props): React.JSX.Element {
  return (
    <button
      type="button"
      className="agent-instructions__button"
      aria-label={`${path} を作成`}
      disabled={isBlocked}
      aria-disabled={isCreating ? true : undefined}
      onClick={() => {
        if (!isCreating) onCreate()
      }}
    >
      作成
    </button>
  )
}
