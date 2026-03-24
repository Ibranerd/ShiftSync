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

  const result = await validateAssignment(
    candidateUserId,
    context.targetShift,
    context.existingAssignments,
    context.userSkills,
    context.userLocations,
    context.availabilityWindows,
    [],
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
