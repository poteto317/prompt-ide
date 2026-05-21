import { Panel } from '../types'

interface Props {
  activePanel: Panel
  onPanelChange: (panel: Panel) => void
}

const ExplorerIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
    <path d="M13 9h5.5L13 3.5V9M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m5 2H6v16h12v-9h-7V4z" />
  </svg>
)

const GitIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
    <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm0 2h7v5h5v11H6V4zm8 8a2 2 0 0 0-2 2 2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0-2-2zM9 13v4h1v-1.5a1.5 1.5 0 0 0 1.5-1.5A1.5 1.5 0 0 0 10 13H9zm1 1h.5a.5.5 0 0 1 .5.5.5.5 0 0 1-.5.5H10v-1z" />
  </svg>
)

const PromptIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
    <path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4V8h16v10zM6.5 10.5l1.41 1.41L9.33 10.5l1.17 1.17-1.42 1.41 1.42 1.42-1.17 1.17L8 14.34l-1.5 1.33-1.17-1.17 1.42-1.41-1.42-1.41L6.5 10.5zM11 13v-1h5.5v1H11zm0 2v-1h5.5v1H11z" />
  </svg>
)

const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
    <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.92c.04-.3.07-.62.07-.95s-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1s.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.41 1.08.73 1.69.99l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.26 1.17-.58 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66z" />
  </svg>
)

const panels: { panel: Panel; icon: React.ReactNode; title: string }[] = [
  { panel: 'explorer', icon: <ExplorerIcon />, title: 'エクスプローラー' },
  { panel: 'source-control', icon: <GitIcon />, title: 'ソース管理' },
  { panel: 'prompts', icon: <PromptIcon />, title: 'プロンプト' },
]

export default function ActivityBar({ activePanel, onPanelChange }: Props) {
  return (
    <div className="activity-bar">
      {panels.map(({ panel, icon, title }) => (
        <button
          key={panel}
          className={`activity-bar__item${activePanel === panel ? ' active' : ''}`}
          title={title}
          onClick={() => onPanelChange(panel)}
        >
          {icon}
        </button>
      ))}
      <div className="activity-bar__bottom">
        <button className="activity-bar__item" title="設定">
          <SettingsIcon />
        </button>
      </div>
    </div>
  )
}
