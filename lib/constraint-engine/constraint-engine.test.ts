import { describe, expect, it } from "vitest"
import {
  ruleAvailability,
  ruleConsecutiveDays,
  ruleDailyHours,
  ruleLocationCertification,
  ruleNoOverlap,
  ruleRestGap,
  ruleSkillMatch,
  ruleWeeklyHoursWarning,
  validateAssignment,
  type Shift,
  type ShiftAssignment,
} from "./index"

const baseShift: Shift = {
  id: "shift-1",
  locationId: "loc-1",
  locationTimezone: "America/New_York",
  startUtc: "2025-01-10T14:00:00.000Z",
  endUtc: "2025-01-10T22:00:00.000Z",
  requiredSkillIds: [],
}

const makeAssignment = (startUtc: string, endUtc: string, status: "assigned" | "confirmed" | "dropped" = "assigned"): ShiftAssignment => ({
  id: crypto.randomUUID(),
  shiftId: "shift-x",
  userId: "user-1",
  status,
  shiftStartUtc: startUtc,
  shiftEndUtc: endUtc,
})

describe("constraint engine rules", () => {
  it("blocks overlapping shifts", () => {
    const violations = ruleNoOverlap(baseShift, [
      makeAssignment("2025-01-10T18:00:00.000Z", "2025-01-10T23:00:00.000Z"),
    ])
    expect(violations[0]?.rule).toBe("DOUBLE_BOOK")
  })

  it("ignores dropped overlaps", () => {
    const violations = ruleNoOverlap(baseShift, [
      makeAssignment("2025-01-10T18:00:00.000Z", "2025-01-10T23:00:00.000Z", "dropped"),
    ])
    expect(violations).toHaveLength(0)
  })

  it("blocks rest gap under 10 hours", () => {
    const violations = ruleRestGap(baseShift, [
      makeAssignment("2025-01-10T04:00:00.000Z", "2025-01-10T08:00:00.000Z"),
    ])
    expect(violations[0]?.rule).toBe("REST_GAP")
  })

  it("ignores dropped shifts when checking rest gap", () => {
    const violations = ruleRestGap(baseShift, [
      makeAssignment("2025-01-10T04:00:00.000Z", "2025-01-10T08:00:00.000Z", "dropped"),
    ])
    expect(violations).toHaveLength(0)
  })

  it("blocks missing required skills", () => {
    const violations = ruleSkillMatch(
      { ...baseShift, requiredSkillIds: ["skill-a"] },
      [],
    )
    expect(violations[0]?.rule).toBe("SKILL_MISMATCH")
  })

  it("blocks when not certified for location", () => {
    const violations = ruleLocationCertification(baseShift, [
      {
        userId: "user-1",
        locationId: "other-location",
        certifiedAt: "2024-12-01T00:00:00.000Z",
        revokedAt: null,
      },
    ])
    expect(violations[0]?.rule).toBe("LOCATION_NOT_CERTIFIED")
  })

  it("blocks when certification is revoked", () => {
    const violations = ruleLocationCertification(baseShift, [
      {
        userId: "user-1",
        locationId: "loc-1",
        certifiedAt: "2024-12-01T00:00:00.000Z",
        revokedAt: "2025-01-01T00:00:00.000Z",
      },
    ])
    expect(violations[0]?.rule).toBe("LOCATION_NOT_CERTIFIED")
  })

  it("blocks availability conflicts and respects exceptions", () => {
    const ok = ruleAvailability(baseShift, [
      {
        userId: "user-1",
        dayOfWeek: 5,
        startLocalTime: "09:00:00",
        endLocalTime: "17:00:00",
        isUnavailable: false,
      },
    ])
    expect(ok).toHaveLength(0)

    const conflict = ruleAvailability(baseShift, [
      {
        userId: "user-1",
        dayOfWeek: 5,
        startLocalTime: "10:00:00",
        endLocalTime: "12:00:00",
        isUnavailable: false,
      },
    ])
    expect(conflict[0]?.rule).toBe("AVAILABILITY_CONFLICT")

    const exception = ruleAvailability(baseShift, [
      {
        userId: "user-1",
        dayOfWeek: 5,
        startLocalTime: "09:00:00",
        endLocalTime: "17:00:00",
        isUnavailable: false,
      },
      {
        userId: "user-1",
        exceptionDate: "2025-01-10",
        startLocalTime: "12:00:00",
        endLocalTime: "13:00:00",
        isUnavailable: true,
      },
    ])
    expect(exception[0]?.rule).toBe("AVAILABILITY_CONFLICT")
  })

  it("allows overnight shift when availability covers both days", () => {
    const overnightShift: Shift = {
      ...baseShift,
      startUtc: "2025-01-10T22:00:00.000Z",
      endUtc: "2025-01-11T04:00:00.000Z",
    }
    const violations = ruleAvailability(overnightShift, [
      {
        userId: "user-1",
        dayOfWeek: 5,
        startLocalTime: "00:00:00",
        endLocalTime: "23:59:00",
        isUnavailable: false,
      },
      {
        userId: "user-1",
        dayOfWeek: 6,
        startLocalTime: "00:00:00",
        endLocalTime: "23:59:00",
        isUnavailable: false,
      },
    ])
    expect(violations).toHaveLength(0)
  })

  it("handles DST transitions without availability false positives", () => {
    const dstShift: Shift = {
      ...baseShift,
      startUtc: "2025-03-09T06:00:00.000Z",
      endUtc: "2025-03-09T10:00:00.000Z",
      locationTimezone: "America/New_York",
    }
    const violations = ruleAvailability(dstShift, [
      {
        userId: "user-1",
        dayOfWeek: 0,
        startLocalTime: "00:00:00",
        endLocalTime: "23:59:00",
        isUnavailable: false,
      },
    ])
    expect(violations).toHaveLength(0)
  })

  it("allows dual-location certified staff for target location only", () => {
    const violations = ruleLocationCertification(
      { ...baseShift, locationId: "loc-2" },
      [
        {
          userId: "user-1",
          locationId: "loc-1",
          certifiedAt: "2024-12-01T00:00:00.000Z",
          revokedAt: null,
        },
        {
          userId: "user-1",
          locationId: "loc-2",
          certifiedAt: "2024-12-15T00:00:00.000Z",
          revokedAt: null,
        },
      ],
    )
    expect(violations).toHaveLength(0)
  })

  it("blocks daily hours over 12", () => {
    const violations = ruleDailyHours(baseShift, [
      makeAssignment("2025-01-10T00:00:00.000Z", "2025-01-10T06:00:00.000Z"),
    ])
    expect(violations[0]?.rule).toBe("DAILY_HOURS_EXCEEDED")
  })

  it("warns when daily hours reach 8", () => {
    const violations = ruleDailyHours(baseShift, [
      makeAssignment("2025-01-10T00:00:00.000Z", "2025-01-10T02:00:00.000Z"),
    ])
    expect(violations[0]?.severity).toBe("warn")
  })

  it("warns on weekly hours at or above 35", () => {
    const violations = ruleWeeklyHoursWarning(baseShift, [
      makeAssignment("2025-01-06T14:00:00.000Z", "2025-01-06T22:00:00.000Z"),
      makeAssignment("2025-01-07T14:00:00.000Z", "2025-01-07T22:00:00.000Z"),
      makeAssignment("2025-01-08T14:00:00.000Z", "2025-01-08T22:00:00.000Z"),
      makeAssignment("2025-01-09T14:00:00.000Z", "2025-01-09T22:00:00.000Z"),
    ])
    expect(violations[0]?.rule).toBe("WEEKLY_HOURS_WARNING")
  })

  it("blocks seventh consecutive day", () => {
    const assignments = [
      makeAssignment("2025-01-04T12:00:00.000Z", "2025-01-04T18:00:00.000Z"),
      makeAssignment("2025-01-05T12:00:00.000Z", "2025-01-05T18:00:00.000Z"),
      makeAssignment("2025-01-06T12:00:00.000Z", "2025-01-06T18:00:00.000Z"),
      makeAssignment("2025-01-07T12:00:00.000Z", "2025-01-07T18:00:00.000Z"),
      makeAssignment("2025-01-08T12:00:00.000Z", "2025-01-08T18:00:00.000Z"),
      makeAssignment("2025-01-09T12:00:00.000Z", "2025-01-09T18:00:00.000Z"),
    ]
    const violations = ruleConsecutiveDays(baseShift, assignments)
    expect(violations[0]?.rule).toBe("CONSECUTIVE_DAYS_7")
  })

  it("warns on sixth consecutive day", () => {
    const assignments = [
      makeAssignment("2025-01-05T12:00:00.000Z", "2025-01-05T18:00:00.000Z"),
      makeAssignment("2025-01-06T12:00:00.000Z", "2025-01-06T18:00:00.000Z"),
      makeAssignment("2025-01-07T12:00:00.000Z", "2025-01-07T18:00:00.000Z"),
      makeAssignment("2025-01-08T12:00:00.000Z", "2025-01-08T18:00:00.000Z"),
      makeAssignment("2025-01-09T12:00:00.000Z", "2025-01-09T18:00:00.000Z"),
    ]
    const violations = ruleConsecutiveDays(baseShift, assignments)
    expect(violations[0]?.rule).toBe("CONSECUTIVE_DAYS_6")
    expect(violations[0]?.severity).toBe("warn")
  })

  it("allows manager override for seventh consecutive day", async () => {
    const assignments = [
      makeAssignment("2025-01-04T12:00:00.000Z", "2025-01-04T18:00:00.000Z"),
      makeAssignment("2025-01-05T12:00:00.000Z", "2025-01-05T18:00:00.000Z"),
      makeAssignment("2025-01-06T12:00:00.000Z", "2025-01-06T18:00:00.000Z"),
      makeAssignment("2025-01-07T12:00:00.000Z", "2025-01-07T18:00:00.000Z"),
      makeAssignment("2025-01-08T12:00:00.000Z", "2025-01-08T18:00:00.000Z"),
      makeAssignment("2025-01-09T12:00:00.000Z", "2025-01-09T18:00:00.000Z"),
    ]
    const result = await validateAssignment(
      "user-1",
      baseShift,
      assignments,
      [],
      [
        {
          userId: "user-1",
          locationId: "loc-1",
          certifiedAt: "2024-12-01T00:00:00.000Z",
          revokedAt: null,
        },
      ],
      [
        {
          userId: "user-1",
          dayOfWeek: 5,
          startLocalTime: "00:00:00",
          endLocalTime: "23:59:00",
          isUnavailable: false,
        },
      ],
      [],
      "Approved by manager",
    )
    expect(result.valid).toBe(true)
  })
})
