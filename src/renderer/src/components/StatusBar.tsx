const BranchIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
    <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 019 8.5H5a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 015 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
  </svg>
)

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
