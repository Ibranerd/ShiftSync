import { describe, expect, it, vi, beforeEach } from "vitest"
import { POST } from "@/app/api/assignments/route"
import { createSupabaseMock } from "./supabase-mock"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { validateAssignment } from "@/lib/constraint-engine"
import { loadAssignmentContext } from "@/lib/constraint-engine/server"

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock("@/lib/constraint-engine", () => ({
  validateAssignment: vi.fn(),
}))

vi.mock("@/lib/constraint-engine/server", () => ({
  loadAssignmentContext: vi.fn(),
}))

const mockedCreateClient = vi.mocked(createSupabaseServerClient)
const mockedValidate = vi.mocked(validateAssignment)
const mockedLoadContext = vi.mocked(loadAssignmentContext)

const baseContext = {
  targetShift: {
    id: "shift-1",
    locationId: "loc-1",
    locationTimezone: "UTC",
    startUtc: "2025-01-10T10:00:00.000Z",
    endUtc: "2025-01-10T18:00:00.000Z",
    requiredSkillIds: [],
  },
  existingAssignments: [],
  userSkills: [],
  userLocations: [],
  availabilityWindows: [],
}

const makeRequest = (body: Record<string, unknown>) =>
  new Request("http://localhost/api/assignments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  mockedValidate.mockReset()
  mockedLoadContext.mockReset()
  mockedCreateClient.mockReset()
})

describe("assignments API", () => {
  it("returns headcount_full when RPC reports capacity", async () => {
    mockedLoadContext.mockResolvedValue({ context: baseContext })
    mockedValidate.mockResolvedValue({ valid: true, violations: [], suggestions: [] })
    const supabase = createSupabaseMock({
      users: {
        select: () => ({ data: [], error: null }),
      },
    }, {
      assign_staff_to_shift: () => ({ data: { error: "headcount_full", message: "Shift full" }, error: null }),
    })

    mockedCreateClient.mockResolvedValue(supabase as any)

    const response = await POST(makeRequest({ candidateUserId: "user-1", shiftId: "shift-1" }))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe("headcount_full")
  })

  it("returns validation_failed when assignment invalid", async () => {
    mockedLoadContext.mockResolvedValue({ context: baseContext })
    mockedValidate.mockResolvedValue({
      valid: false,
      violations: [{ rule: "DOUBLE_BOOK", message: "Overlap", severity: "block" }],
      suggestions: [],
    })

    const supabase = createSupabaseMock({
      users: {
        select: () => ({ data: [], error: null }),
      },
    })

    mockedCreateClient.mockResolvedValue(supabase as any)

    const response = await POST(makeRequest({ candidateUserId: "user-1", shiftId: "shift-1" }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.result.valid).toBe(false)
    expect(data.result.violations[0].rule).toBe("DOUBLE_BOOK")
  })
})
