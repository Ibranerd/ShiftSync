export interface FairnessScore {
  userId: string
  totalHours: number
  premiumShiftCount: number
  score: number
}

export interface FairnessInput {
  userId: string
  hours: number
  premiumShifts: number
}

export function calculateFairnessScores(inputs: FairnessInput[]): FairnessScore[] {
  const totals = new Map<string, { hours: number; premium: number; shifts: number }>()

  inputs.forEach((input) => {
    const current = totals.get(input.userId) ?? { hours: 0, premium: 0, shifts: 0 }
    current.hours += input.hours
    current.premium += input.premiumShifts
    current.shifts += 1
    totals.set(input.userId, current)
  })

  const ratios: number[] = []
  totals.forEach((value) => {
    const ratio = value.shifts > 0 ? value.premium / value.shifts : 0
    ratios.push(ratio)
  })
  const averageRatio = ratios.length > 0 ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : 0

  return Array.from(totals.entries()).map(([userId, value]) => {
    const ratio = value.shifts > 0 ? value.premium / value.shifts : 0
    const deviation = Math.abs(ratio - averageRatio)
    const score = Math.max(0, 100 - deviation * 200)
    return {
      userId,
      totalHours: Number(value.hours.toFixed(2)),
      premiumShiftCount: value.premium,
      score: Number(score.toFixed(1)),
    }
  })
}
