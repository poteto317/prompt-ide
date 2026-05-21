import { Panel } from '../types'

interface Props {
  activePanel: Panel
}

const titles: Record<Panel, string> = {
  explorer: 'エクスプローラー',
  'source-control': 'ソース管理',
  prompts: 'プロンプト',
}

export default function Sidebar({ activePanel }: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar__header">{titles[activePanel]}</div>
      <div className="sidebar__placeholder">
        {activePanel === 'explorer' && 'フォルダを開くと、ファイルツリーがここに表示されます。'}
        {activePanel === 'source-control' && 'Git の変更がここに表示されます。'}
        {activePanel === 'prompts' && 'プロンプトを登録すると、ここに一覧が表示されます。'}
      </div>
    </div>
  )
}
