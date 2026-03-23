export interface WeeklyHours {
  userId: string
  weekStartUtc: string
  totalHours: number
}

function getWeekStartKey(date: Date) {
  const day = date.getUTCDay() || 7
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (day - 1)))
  return monday.toISOString().slice(0, 10)
}

export function calculateWeeklyHours(assignments: Array<{ userId?: string; startUtc: string; endUtc: string }>): WeeklyHours[] {
  const totals = new Map<string, { userId: string; hours: number }>()

  assignments.forEach((assignment) => {
    const start = new Date(assignment.startUtc)
    const end = new Date(assignment.endUtc)
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
    const weekKey = getWeekStartKey(start)
    const userId = assignment.userId ?? "unknown"
    const key = `${userId}:${weekKey}`
    const current = totals.get(key)
    if (current) {
      current.hours += hours
    } else {
      totals.set(key, { userId, hours })
    }
  })

  return Array.from(totals.entries()).map(([key, value]) => {
    const [, weekStartUtc] = key.split(":")
    return {
      userId: value.userId,
      weekStartUtc,
      totalHours: Number(value.hours.toFixed(2)),
    }
  })
}
