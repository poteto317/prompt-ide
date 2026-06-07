export function formatEventDate(occurredAt: number): string {
  const d = new Date(occurredAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`
}

export function progressSummary(doneCount: number, total: number): string {
  return `${doneCount}/${total}`
}

export function formatEventMeta(meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' / ')
}
