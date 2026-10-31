interface ChevronIconProps {
  direction: 'down' | 'right'
}

// 開閉の矢印。文字の ▾ / ▸ は文字サイズの割に小さく見えづらいため、太い線の SVG で描く
export default function ChevronIcon({ direction }: ChevronIconProps): React.JSX.Element {
  return (
    <svg
      className="chevron-icon"
      data-direction={direction}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path d={direction === 'down' ? 'M5 9l7 7 7-7' : 'M9 5l7 7-7 7'} />
    </svg>
  )
}
