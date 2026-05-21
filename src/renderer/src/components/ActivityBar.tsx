import { activityBarPanels } from '../config/activityBarPanels'
import { SettingsIcon } from './icons'
import { Panel } from '../types'

interface Props {
  activePanel: Panel
  onPanelChange: (panel: Panel) => void
}

export default function ActivityBar({ activePanel, onPanelChange }: Props) {
  return (
    <div className="activity-bar">
      {activityBarPanels.map(({ panel, Icon, title }) => (
        <button
          key={panel}
          className={`activity-bar__item${activePanel === panel ? ' active' : ''}`}
          title={title}
          aria-label={title}
          aria-pressed={activePanel === panel}
          onClick={() => onPanelChange(panel)}
        >
          <Icon />
        </button>
      ))}
      <div className="activity-bar__bottom">
        <button className="activity-bar__item" title="設定" aria-label="設定">
          <SettingsIcon />
        </button>
      </div>
    </div>
  )
}
