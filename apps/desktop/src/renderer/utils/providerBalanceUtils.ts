export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60000))
  if (totalMinutes < 60) return `${totalMinutes} 分钟`
  const hours = Math.floor(totalMinutes / 60)
  const restMinutes = totalMinutes % 60
  return restMinutes
    ? `${hours} 小时 ${restMinutes} 分`
    : `${hours} 小时`
}

export function formatRemainingWindow(
  remainingTime: number | null,
  endTime: number | null,
): string {
  if (remainingTime != null && remainingTime > 0) {
    return formatDuration(remainingTime)
  }
  if (endTime != null && endTime > 0) {
    return new Date(endTime).toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
    })
  }
  return '—'
}

export function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}
