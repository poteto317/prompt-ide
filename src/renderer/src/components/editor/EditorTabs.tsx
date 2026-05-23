interface Props {
  fileName: string
}

export default function EditorTabs({ fileName }: Props) {
  return (
    <div className="editor-tabs">
      <div className="editor-tab editor-tab--active">{fileName}</div>
    </div>
  )
}
