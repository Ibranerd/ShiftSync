import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/swaps/route"
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
  new Request("http://localhost/api/swaps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  mockedValidate.mockReset()
  mockedLoadContext.mockReset()
  mockedCreateClient.mockReset()
})

describe("swaps API", () => {
  it("creates a swap request", async () => {
    mockedLoadContext.mockResolvedValue({ context: baseContext })
    mockedValidate.mockResolvedValue({ valid: true, violations: [], suggestions: [] })

    const supabase = createSupabaseMock({
      shift_assignments: {
        single: () => ({
          data: { id: "assign-1", shift_id: "shift-1", user_id: "staff-1", status: "assigned" },
          error: null,
        }),
      },
      swap_requests: {
        select: () => ({ data: [], error: null, count: 0 }),
        single: () => ({ data: { id: "swap-1", status: "pending_staff" }, error: null }),
      },
    })

    mockedCreateClient.mockResolvedValue(supabase as any)

    const response = await POST(
      makeRequest({ action: "request", status: "pending_staff", assignmentId: "assign-1", targetUserId: "staff-2" }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.swap?.id).toBe("swap-1")
  })

  it("returns assignment_conflict when slot changed before approval", async () => {
    mockedLoadContext.mockResolvedValue({ context: baseContext })
    mockedValidate.mockResolvedValue({ valid: true, violations: [], suggestions: [] })

    const supabase = createSupabaseMock({
      swap_requests: {
        single: () => ({
          data: {
            id: "swap-1",
            shift_id: "shift-1",
            assignment_id: "assign-1",
            requested_by: "staff-1",
            target_user_id: "staff-2",
            status: "pending_manager",
          },
          error: null,
        }),
      },
      shifts: {
        single: () => ({ data: { location_id: "loc-1" }, error: null }),
      },
      location_managers: {
        select: () => ({ data: [], error: null, count: 1 }),
      },
      shift_assignments: {
        select: () => ({ data: [], error: null }),
      },
    }, {
      lock_swap_approval: () => ({ data: true, error: null }),
    })

    mockedCreateClient.mockResolvedValue(supabase as any)

    const response = await POST(
      makeRequest({ action: "approve", status: "pending_manager", swapId: "swap-1" }),
    )
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe("assignment_conflict")
  })
})
