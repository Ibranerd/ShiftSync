import type { AvailabilityWindow, Shift, ShiftAssignment, Skill, UserLocation } from "./index"

type SupabaseLike = {
  from: (table: string) => any
}

export type AssignmentContext = {
  targetShift: Shift
  existingAssignments: ShiftAssignment[]
  userSkills: Skill[]
  userLocations: UserLocation[]
  availabilityWindows: AvailabilityWindow[]
}

export async function loadAssignmentContext(
  supabase: SupabaseLike,
  candidateUserId: string,
  shiftId: string,
): Promise<{ context?: AssignmentContext; error?: string }> {
  const { data: shiftRow, error: shiftError } = await supabase
    .from("shifts")
    .select("id,location_id,start_utc,end_utc,required_skill_ids,locations:locations (timezone)")
    .eq("id", shiftId)
    .single()

  if (shiftError || !shiftRow) {
    return { error: "shift_not_found" }
  }

  const targetShift: Shift = {
    id: shiftRow.id,
    locationId: shiftRow.location_id,
    locationTimezone: shiftRow.locations?.timezone ?? "UTC",
    startUtc: shiftRow.start_utc,
    endUtc: shiftRow.end_utc,
    requiredSkillIds: shiftRow.required_skill_ids ?? [],
  }

  const { data: assignmentRows } = await supabase
    .from("shift_assignments")
    .select("id,shift_id,user_id,status,shifts:shifts (start_utc,end_utc)")
    .eq("user_id", candidateUserId)

  const existingAssignments: ShiftAssignment[] =
    assignmentRows?.map((row: any) => ({
      id: row.id,
      shiftId: row.shift_id,
      userId: row.user_id,
      status: row.status,
      shiftStartUtc: row.shifts?.start_utc,
      shiftEndUtc: row.shifts?.end_utc,
    })) ?? []

  const { data: skillRows } = await supabase
    .from("user_skills")
    .select("skills:skills (id,name)")
    .eq("user_id", candidateUserId)

  const userSkills: Skill[] =
    skillRows?.map((row: any) => ({
      id: row.skills?.id,
      name: row.skills?.name,
    })) ?? []

  const { data: locationRows } = await supabase
    .from("user_locations")
    .select("user_id,location_id,certified_at,revoked_at")
    .eq("user_id", candidateUserId)

  const userLocations: UserLocation[] =
    locationRows?.map((row: any) => ({
      userId: row.user_id,
      locationId: row.location_id,
      certifiedAt: row.certified_at,
      revokedAt: row.revoked_at,
    })) ?? []

  const { data: availabilityRows } = await supabase
    .from("availability_windows")
    .select("user_id,day_of_week,start_local_time,end_local_time,exception_date,is_unavailable")
    .eq("user_id", candidateUserId)

  const availabilityWindows: AvailabilityWindow[] =
    availabilityRows?.map((row: any) => ({
      userId: row.user_id,
      dayOfWeek: row.day_of_week,
      startLocalTime: row.start_local_time,
      endLocalTime: row.end_local_time,
      exceptionDate: row.exception_date,
      isUnavailable: row.is_unavailable,
    })) ?? []

  return {
    context: {
      targetShift,
      existingAssignments,
      userSkills,
      userLocations,
      availabilityWindows,
    },
  }
}
