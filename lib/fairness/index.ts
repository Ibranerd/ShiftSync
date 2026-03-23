export interface FairnessScore {
  userId: string
  totalHours: number
  premiumShiftCount: number
  score: number
}

export function calculateFairnessScores(_inputs: Array<{ userId: string; hours: number; premiumShifts: number }>): FairnessScore[] {
  return []
}
