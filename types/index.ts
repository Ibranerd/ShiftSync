export type Role = "admin" | "manager" | "staff"

export interface UserProfile {
  id: string
  fullName: string
  role: Role
  desiredWeeklyHours?: number
}

export interface Location {
  id: string
  name: string
  timezone: string
}

export interface Shift {
  id: string
  locationId: string
  locationTimezone: string
  startUtc: string
  endUtc: string
  isPremium: boolean
}
