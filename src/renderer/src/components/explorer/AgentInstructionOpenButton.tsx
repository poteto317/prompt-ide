// 指示ファイルの節の `開く`(このフォルダ・サブフォルダで共通)。clone 中は押す前から押せないので disabled、作成の途中は押した結果
// として起きる状態なので aria-disabled にして押しても何もしない(disabled にするとフォーカスが body に落ちる。L-157)
interface Props {
  relativePath: string
  isBlocked: boolean
  isCreating: boolean
  onOpen: () => void
}

export default function AgentInstructionOpenButton({
  relativePath,
  isBlocked,
  isCreating,
  onOpen
}: Props): React.JSX.Element {
  return (
    <button
      type="button"
      className="agent-instructions__button"
      aria-label={`${relativePath} を開く`}
      disabled={isBlocked}
      aria-disabled={isCreating ? true : undefined}
      onClick={() => {
        if (!isCreating) onOpen()
      }}
    >
      開く
    </button>
  )
}
