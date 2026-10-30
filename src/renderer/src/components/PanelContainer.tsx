interface Props {
  isActive: boolean
  children: React.ReactNode
}

export default function PanelContainer({ isActive, children }: Props): React.JSX.Element {
  return (
    <div className={isActive ? 'sidebar__panel' : 'sidebar__panel sidebar__panel--hidden'}>
      {children}
    </div>
  )
}
