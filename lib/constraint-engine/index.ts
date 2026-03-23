export interface ValidationResult {
  valid: boolean
  violations: Violation[]
  suggestions: StaffSuggestion[]
}

export interface Violation {
  rule: RuleCode
  message: string
  severity: "block" | "warn"
}

export type RuleCode =
  | "DOUBLE_BOOK"
  | "REST_GAP"
  | "SKILL_MISMATCH"
  | "LOCATION_NOT_CERTIFIED"
  | "AVAILABILITY_CONFLICT"
  | "DAILY_HOURS_EXCEEDED"
  | "WEEKLY_HOURS_WARNING"
  | "CONSECUTIVE_DAYS_7"
  | "CONSECUTIVE_DAYS_6"

export interface StaffSuggestion {
  userId: string
  reason: string
}

export interface StaffCandidate {
  userId: string
  skills: Skill[]
  locations: UserLocation[]
  availability: AvailabilityWindow[]
  assignments: ShiftAssignment[]
}

export interface Shift {
  id: string
  locationId: string
  locationTimezone: string
  startUtc: string
  endUtc: string
  requiredSkillIds: string[]
}

export interface ShiftAssignment {
  id: string
  shiftId: string
  userId: string
  status: "assigned" | "confirmed" | "dropped"
  shiftStartUtc: string
  shiftEndUtc: string
}

export interface Skill {
  id: string
  name: string
}

export interface UserLocation {
  userId: string
  locationId: string
  certifiedAt: string
  revokedAt?: string | null
}

export interface AvailabilityWindow {
  userId: string
  dayOfWeek?: number | null
  startLocalTime: string
  endLocalTime: string
  exceptionDate?: string | null
  isUnavailable: boolean
}

import { format, toZonedTime } from "date-fns-tz"

const MIN_REST_HOURS = 10
const DAILY_HOURS_LIMIT = 12
const WEEKLY_WARNING_HOURS = 35

const DAY_IN_MS = 24 * 60 * 60 * 1000

function toDate(value: string) {
  return new Date(value)
}

function hoursBetween(a: Date, b: Date) {
  return Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60)
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB
}

function parseLocalMinutes(value: string) {
  const [hours, minutes, seconds] = value.split(":").map(Number)
  return (hours || 0) * 60 + (minutes || 0) + (seconds || 0) / 60
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function getUtcDateKeysForRange(start: Date, end: Date) {
  const keys: string[] = []
  let cursor = startOfUtcDay(start)
  const endDay = startOfUtcDay(end)
  while (cursor <= endDay) {
    keys.push(formatDateKey(cursor))
    cursor = addDays(cursor, 1)
  }
  return keys
}

function addHoursToDailyMap(map: Map<string, number>, start: Date, end: Date) {
  let cursor = start
  while (cursor < end) {
    const dayEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1))
    const segmentEnd = dayEnd < end ? dayEnd : end
    const key = formatDateKey(cursor)
    const hours = (segmentEnd.getTime() - cursor.getTime()) / (1000 * 60 * 60)
    map.set(key, (map.get(key) || 0) + hours)
    cursor = segmentEnd
  }
}

function getWeekStartKey(date: Date) {
  const day = date.getUTCDay() || 7
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (day - 1)))
  return formatDateKey(monday)
}

export function ruleNoOverlap(targetShift: Shift, assignments: ShiftAssignment[]): Violation[] {
  const targetStart = toDate(targetShift.startUtc)
  const targetEnd = toDate(targetShift.endUtc)
  const conflict = assignments.some((assignment) => {
    if (assignment.status === "dropped") return false
    return overlaps(targetStart, targetEnd, toDate(assignment.shiftStartUtc), toDate(assignment.shiftEndUtc))
  })

  if (!conflict) return []

  return [
    {
      rule: "DOUBLE_BOOK",
      message: "Staff member already has an overlapping shift.",
      severity: "block",
    },
  ]
}

export function ruleRestGap(targetShift: Shift, assignments: ShiftAssignment[]): Violation[] {
  const targetStart = toDate(targetShift.startUtc)
  const targetEnd = toDate(targetShift.endUtc)
  const conflict = assignments.some((assignment) => {
    if (assignment.status === "dropped") return false
    const start = toDate(assignment.shiftStartUtc)
    const end = toDate(assignment.shiftEndUtc)
    if (overlaps(targetStart, targetEnd, start, end)) return false
    if (end <= targetStart) {
      return hoursBetween(end, targetStart) < MIN_REST_HOURS
    }
    if (start >= targetEnd) {
      return hoursBetween(targetEnd, start) < MIN_REST_HOURS
    }
    return false
  })

  if (!conflict) return []

  return [
    {
      rule: "REST_GAP",
      message: "Minimum rest gap of 10 hours is required.",
      severity: "block",
    },
  ]
}

export function ruleSkillMatch(targetShift: Shift, userSkills: Skill[]): Violation[] {
  if (targetShift.requiredSkillIds.length === 0) return []
  const skillIds = new Set(userSkills.map((skill) => skill.id))
  const missing = targetShift.requiredSkillIds.some((id) => !skillIds.has(id))
  if (!missing) return []
  return [
    {
      rule: "SKILL_MISMATCH",
      message: "Staff member does not have required skills for this shift.",
      severity: "block",
    },
  ]
}

export function ruleLocationCertification(targetShift: Shift, userLocations: UserLocation[]): Violation[] {
  const targetStart = toDate(targetShift.startUtc)
  const certified = userLocations.some((entry) => {
    if (entry.locationId !== targetShift.locationId) return false
    const certifiedAt = toDate(entry.certifiedAt)
    const revokedAt = entry.revokedAt ? toDate(entry.revokedAt) : null
    return certifiedAt <= targetStart && (!revokedAt || revokedAt > targetStart)
  })
  if (certified) return []
  return [
    {
      rule: "LOCATION_NOT_CERTIFIED",
      message: "Staff member is not certified for this location.",
      severity: "block",
    },
  ]
}

export function ruleAvailability(
  targetShift: Shift,
  availabilityWindows: AvailabilityWindow[],
): Violation[] {
  const start = toDate(targetShift.startUtc)
  const end = toDate(targetShift.endUtc)
  const zonedStart = toZonedTime(start, targetShift.locationTimezone)
  const zonedEnd = toZonedTime(end, targetShift.locationTimezone)
  const startKey = format(zonedStart, "yyyy-MM-dd", { timeZone: targetShift.locationTimezone })
  const endKey = format(zonedEnd, "yyyy-MM-dd", { timeZone: targetShift.locationTimezone })

  const buildWindowsForDay = (dateKey: string, dayOfWeek: number) => {
    const exceptions = availabilityWindows.filter((window) => window.exceptionDate === dateKey)
    const windows = exceptions.length > 0 ? exceptions : availabilityWindows.filter((window) => !window.exceptionDate)
    return windows.filter((window) => (window.exceptionDate ? true : window.dayOfWeek === dayOfWeek))
  }

  const evaluateDay = (dateKey: string, dayOfWeek: number, startMinutes: number, endMinutes: number): Violation[] => {
    const applicable = buildWindowsForDay(dateKey, dayOfWeek)
    const blackout = applicable.some((window) => {
      if (!window.isUnavailable) return false
      const windowStart = parseLocalMinutes(window.startLocalTime)
      const windowEnd = parseLocalMinutes(window.endLocalTime)
      return startMinutes < windowEnd && endMinutes > windowStart
    })

    if (blackout) {
      return [
        {
          rule: "AVAILABILITY_CONFLICT",
          message: "Shift conflicts with unavailable time window.",
          severity: "block",
        },
      ]
    }

    const covered = applicable.some((window) => {
      if (window.isUnavailable) return false
      const windowStart = parseLocalMinutes(window.startLocalTime)
      const windowEnd = parseLocalMinutes(window.endLocalTime)
      return startMinutes >= windowStart && endMinutes <= windowEnd
    })

    if (!covered) {
      return [
        {
          rule: "AVAILABILITY_CONFLICT",
          message: "Shift is outside availability windows.",
          severity: "block",
        },
      ]
    }

    return []
  }

  const shiftStartMinutes = zonedStart.getHours() * 60 + zonedStart.getMinutes()
  const shiftEndMinutes = zonedEnd.getHours() * 60 + zonedEnd.getMinutes()

  if (startKey === endKey) {
    return evaluateDay(startKey, zonedStart.getDay(), shiftStartMinutes, shiftEndMinutes)
  }

  const startDayResult = evaluateDay(startKey, zonedStart.getDay(), shiftStartMinutes, 24 * 60)
  if (startDayResult.length > 0) return startDayResult

  const endDayResult = evaluateDay(endKey, zonedEnd.getDay(), 0, shiftEndMinutes)
  if (endDayResult.length > 0) return endDayResult

  return []
}

export function ruleDailyHours(targetShift: Shift, assignments: ShiftAssignment[]): Violation[] {
  const map = new Map<string, number>()
  const targetStart = toDate(targetShift.startUtc)
  const targetEnd = toDate(targetShift.endUtc)
  addHoursToDailyMap(map, targetStart, targetEnd)
  assignments.forEach((assignment) => {
    if (assignment.status === "dropped") return
    addHoursToDailyMap(map, toDate(assignment.shiftStartUtc), toDate(assignment.shiftEndUtc))
  })

  let warning = false

  for (const hours of map.values()) {
    if (hours > DAILY_HOURS_LIMIT) {
      return [
        {
          rule: "DAILY_HOURS_EXCEEDED",
          message: "Daily hours limit exceeded (12 hours).",
          severity: "block",
        },
      ]
    }
    if (hours >= 8) {
      warning = true
    }
  }

  if (warning) {
    return [
      {
        rule: "DAILY_HOURS_EXCEEDED",
        message: "Warning: daily hours at or above 8 hours.",
        severity: "warn",
      },
    ]
  }

  return []
}

export function ruleWeeklyHoursWarning(targetShift: Shift, assignments: ShiftAssignment[]): Violation[] {
  const weeklyTotals = new Map<string, number>()
  const addToWeek = (start: Date, end: Date) => {
    const weekKey = getWeekStartKey(start)
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
    weeklyTotals.set(weekKey, (weeklyTotals.get(weekKey) || 0) + hours)
  }

  addToWeek(toDate(targetShift.startUtc), toDate(targetShift.endUtc))
  assignments.forEach((assignment) => {
    if (assignment.status === "dropped") return
    addToWeek(toDate(assignment.shiftStartUtc), toDate(assignment.shiftEndUtc))
  })

  for (const hours of weeklyTotals.values()) {
    if (hours >= WEEKLY_WARNING_HOURS) {
      return [
        {
          rule: "WEEKLY_HOURS_WARNING",
          message: "Weekly hours are at or above 35 hours.",
          severity: "warn",
        },
      ]
    }
  }

  return []
}

export function ruleConsecutiveDays(targetShift: Shift, assignments: ShiftAssignment[]): Violation[] {
  const workedDays = new Set<string>()
  const addRange = (start: Date, end: Date) => {
    const days = getUtcDateKeysForRange(start, end)
    days.forEach((day) => workedDays.add(day))
  }

  addRange(toDate(targetShift.startUtc), toDate(targetShift.endUtc))
  assignments.forEach((assignment) => {
    if (assignment.status === "dropped") return
    addRange(toDate(assignment.shiftStartUtc), toDate(assignment.shiftEndUtc))
  })

  const sorted = Array.from(workedDays)
    .map((day) => new Date(`${day}T00:00:00.000Z`))
    .sort((a, b) => a.getTime() - b.getTime())

  let longest = 0
  let current = 0
  let prev: Date | null = null
  for (const date of sorted) {
    if (!prev) {
      current = 1
    } else if (date.getTime() - prev.getTime() === DAY_IN_MS) {
      current += 1
    } else {
      current = 1
    }
    longest = Math.max(longest, current)
    prev = date
  }

  if (longest >= 7) {
    return [
      {
        rule: "CONSECUTIVE_DAYS_7",
        message: "7th consecutive day requires manager override with reason.",
        severity: "block",
      },
    ]
  }

  if (longest >= 6) {
    return [
      {
        rule: "CONSECUTIVE_DAYS_6",
        message: "Warning: 6 consecutive working days.",
        severity: "warn",
      },
    ]
  }

  return []
}

export async function validateAssignment(
  candidateUserId: string,
  targetShift: Shift,
  existingAssignments: ShiftAssignment[],
  userSkills: Skill[],
  userLocations: UserLocation[],
  availabilityWindows: AvailabilityWindow[],
  staffCandidates: StaffCandidate[] = [],
  overrideReason?: string,
): Promise<ValidationResult> {
  const violations: Violation[] = []
  const rules: Array<() => Violation[]> = [
    () => ruleNoOverlap(targetShift, existingAssignments),
    () => ruleRestGap(targetShift, existingAssignments),
    () => ruleSkillMatch(targetShift, userSkills),
    () => ruleLocationCertification(targetShift, userLocations),
    () => ruleAvailability(targetShift, availabilityWindows),
    () => ruleDailyHours(targetShift, existingAssignments),
    () => ruleConsecutiveDays(targetShift, existingAssignments),
    () => ruleWeeklyHoursWarning(targetShift, existingAssignments),
  ]

  for (const rule of rules) {
    const result = rule()
    if (result.length > 0) {
      violations.push(...result)
      if (result.some((item) => item.severity === "block")) {
        break
      }
    }
  }

  if (overrideReason) {
    for (const violation of violations) {
      if (violation.rule === "CONSECUTIVE_DAYS_7" && violation.severity === "block") {
        violation.severity = "warn"
        violation.message = "7th consecutive day approved with manager override."
      }
    }
  }

  const valid = violations.every((item) => item.severity !== "block")
  const suggestions: StaffSuggestion[] = []

  if (!valid && staffCandidates.length > 0) {
    staffCandidates.forEach((candidate) => {
      const candidateViolations: Violation[] = []
      const candidateRules: Array<() => Violation[]> = [
        () => ruleNoOverlap(targetShift, candidate.assignments),
        () => ruleRestGap(targetShift, candidate.assignments),
        () => ruleSkillMatch(targetShift, candidate.skills),
        () => ruleLocationCertification(targetShift, candidate.locations),
        () => ruleAvailability(targetShift, candidate.availability),
        () => ruleDailyHours(targetShift, candidate.assignments),
        () => ruleConsecutiveDays(targetShift, candidate.assignments),
        () => ruleWeeklyHoursWarning(targetShift, candidate.assignments),
      ]

      for (const rule of candidateRules) {
        const result = rule()
        if (result.length > 0) {
          candidateViolations.push(...result)
          if (result.some((item) => item.severity === "block")) {
            break
          }
        }
      }

      if (candidateViolations.every((item) => item.severity !== "block")) {
        suggestions.push({
          userId: candidate.userId,
          reason: "Qualified and available based on current rules.",
        })
      }
    })
  }

  return {
    valid,
    violations,
    suggestions,
  }
}
