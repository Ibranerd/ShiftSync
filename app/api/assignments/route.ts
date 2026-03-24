import { NextResponse } from "next/server"
import { validateAssignment } from "@/lib/constraint-engine"
import { loadAssignmentContext } from "@/lib/constraint-engine/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function GET() {
  return NextResponse.json({ ok: true, route: "assignments" })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 })
  }

  const { candidateUserId, shiftId, overrideReason } = body

  if (!candidateUserId || !shiftId) {
    return NextResponse.json({ ok: false, error: "missing_candidate_or_shift" }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()
  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 })
  }

  const { context, error } = await loadAssignmentContext(supabase, candidateUserId, shiftId)
  if (error || !context) {
    return NextResponse.json({ ok: false, error: error ?? "shift_not_found" }, { status: 404 })
  }

  const { data: staffRows } = await supabase.from("users").select("id").eq("role", "staff")
  const staffIds = (staffRows ?? []).map((row: any) => row.id).filter(Boolean)
  const staffCandidates =
    staffIds.length > 0
      ? await Promise.all([
          supabase
            .from("shift_assignments")
            .select("id,shift_id,user_id,status,shifts:shifts (start_utc,end_utc)")
            .in("user_id", staffIds)
            .neq("status", "dropped"),
          supabase.from("user_skills").select("user_id,skills:skills (id,name)").in("user_id", staffIds),
          supabase
            .from("user_locations")
            .select("user_id,location_id,certified_at,revoked_at")
            .in("user_id", staffIds),
          supabase
            .from("availability_windows")
            .select("user_id,day_of_week,start_local_time,end_local_time,exception_date,is_unavailable")
            .in("user_id", staffIds),
        ]).then(([assignRes, skillRes, locRes, availRes]) => {
          const assignmentsByUser = new Map<string, any[]>()
          assignRes.data?.forEach((row: any) => {
            if (!row.user_id) return
            const entry = {
              id: row.id,
              shiftId: row.shift_id,
              userId: row.user_id,
              status: row.status,
              shiftStartUtc: row.shifts?.start_utc,
              shiftEndUtc: row.shifts?.end_utc,
            }
            const current = assignmentsByUser.get(row.user_id) ?? []
            current.push(entry)
            assignmentsByUser.set(row.user_id, current)
          })

          const skillsByUser = new Map<string, any[]>()
          skillRes.data?.forEach((row: any) => {
            if (!row.user_id) return
            const entry = { id: row.skills?.id, name: row.skills?.name }
            const current = skillsByUser.get(row.user_id) ?? []
            if (entry.id) current.push(entry)
            skillsByUser.set(row.user_id, current)
          })

          const locationsByUser = new Map<string, any[]>()
          locRes.data?.forEach((row: any) => {
            if (!row.user_id) return
            const entry = {
              userId: row.user_id,
              locationId: row.location_id,
              certifiedAt: row.certified_at,
              revokedAt: row.revoked_at,
            }
            const current = locationsByUser.get(row.user_id) ?? []
            current.push(entry)
            locationsByUser.set(row.user_id, current)
          })

          const availabilityByUser = new Map<string, any[]>()
          availRes.data?.forEach((row: any) => {
            if (!row.user_id) return
            const entry = {
              userId: row.user_id,
              dayOfWeek: row.day_of_week,
              startLocalTime: row.start_local_time,
              endLocalTime: row.end_local_time,
              exceptionDate: row.exception_date,
              isUnavailable: row.is_unavailable,
            }
            const current = availabilityByUser.get(row.user_id) ?? []
            current.push(entry)
            availabilityByUser.set(row.user_id, current)
          })

          return staffIds.map((userId) => ({
            userId,
            assignments: assignmentsByUser.get(userId) ?? [],
            skills: skillsByUser.get(userId) ?? [],
            locations: locationsByUser.get(userId) ?? [],
            availability: availabilityByUser.get(userId) ?? [],
          }))
        })
      : []

  const result = await validateAssignment(
    candidateUserId,
    context.targetShift,
    context.existingAssignments,
    context.userSkills,
    context.userLocations,
    context.availabilityWindows,
    staffCandidates,
    overrideReason,
  )

  if (result.valid) {
    const { data: rpcData, error: rpcError } = await supabase.rpc("assign_staff_to_shift", {
      p_shift_id: shiftId,
      p_user_id: candidateUserId,
      p_assigned_by: authData.user.id,
      p_override_reason: overrideReason ?? null,
    })

    if (rpcError) {
      return NextResponse.json({ ok: false, error: rpcError.message }, { status: 500 })
    }

    if (rpcData?.error) {
      return NextResponse.json({ ok: false, error: rpcData.error, message: rpcData.message }, { status: 409 })
    }
  }

  return NextResponse.json({ ok: true, result })
}
