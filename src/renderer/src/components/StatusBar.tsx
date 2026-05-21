import { BranchIcon } from './icons'

export default function StatusBar() {
  return (
    <div className="status-bar">
      <div className="status-bar__item">
        <BranchIcon />
        <span>main</span>
      </div>
      <div className="status-bar__spacer" />
      <div className="status-bar__item">TypeScript</div>
      <div className="status-bar__item">Ln 1, Col 1</div>
      <div className="status-bar__item">UTF-8</div>
    </div>
  )
}
