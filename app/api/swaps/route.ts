import { NextResponse } from "next/server"
import { validateAssignment } from "@/lib/constraint-engine"
import { loadAssignmentContext } from "@/lib/constraint-engine/server"
import { canTransition, nextStatus, type SwapAction, type SwapStatus } from "@/lib/swaps/state-machine"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function GET() {
  return NextResponse.json({ ok: true, route: "swaps", actions: ["request", "accept", "reject", "approve", "cancel", "expire"] })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 })
  }

  const action = body.action as SwapAction | undefined
  const status = body.status as SwapStatus | undefined

  if (!action || !status) {
    return NextResponse.json({ ok: false, error: "missing_action_or_status" }, { status: 400 })
  }

  if (!canTransition(status, action)) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_transition",
        message: `Cannot ${action} when status is ${status}.`,
      },
      { status: 400 },
    )
  }
  const supabase = await createSupabaseServerClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 })
  }

  const swapId = body.swapId as string | undefined
  const shiftId = body.shiftId as string | undefined
  const targetUserId = body.targetUserId as string | undefined
  const reason = body.reason as string | undefined

  if (action === "request") {
    if (!shiftId || !targetUserId) {
      return NextResponse.json({ ok: false, error: "missing_shift_or_target" }, { status: 400 })
    }
    const { context, error: contextError } = await loadAssignmentContext(supabase, targetUserId, shiftId)
    if (contextError || !context) {
      return NextResponse.json({ ok: false, error: contextError ?? "shift_not_found" }, { status: 404 })
    }
    const validation = await validateAssignment(
      targetUserId,
      context.targetShift,
      context.existingAssignments,
      context.userSkills,
      context.userLocations,
      context.availabilityWindows,
      [],
    )
    if (!validation.valid) {
      return NextResponse.json(
        { ok: false, error: "validation_failed", violations: validation.violations },
        { status: 400 },
      )
    }
    const { count } = await supabase
      .from("swap_requests")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", userData.user.id)
      .in("status", ["pending_staff", "pending_manager"])
    if ((count ?? 0) >= 3) {
      return NextResponse.json({ ok: false, error: "swap_limit_reached" }, { status: 400 })
    }
    const { data, error } = await supabase
      .from("swap_requests")
      .insert({
        shift_id: shiftId,
        requested_by: userData.user.id,
        target_user_id: targetUserId,
        status: "pending_staff",
        reason: reason ?? null,
      })
      .select()
      .single()
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, nextStatus: data.status, swap: data })
  }

  if (!swapId) {
    return NextResponse.json({ ok: false, error: "missing_swap_id" }, { status: 400 })
  }

  const { data: swapRow, error: swapError } = await supabase
    .from("swap_requests")
    .select("id,shift_id,target_user_id,status")
    .eq("id", swapId)
    .single()

  if (swapError || !swapRow) {
    return NextResponse.json({ ok: false, error: "swap_not_found" }, { status: 404 })
  }

  if ((action === "accept" || action === "approve") && swapRow.target_user_id) {
    const { context, error: contextError } = await loadAssignmentContext(
      supabase,
      swapRow.target_user_id,
      swapRow.shift_id,
    )
    if (contextError || !context) {
      return NextResponse.json({ ok: false, error: contextError ?? "shift_not_found" }, { status: 404 })
    }
    const validation = await validateAssignment(
      swapRow.target_user_id,
      context.targetShift,
      context.existingAssignments,
      context.userSkills,
      context.userLocations,
      context.availabilityWindows,
      [],
    )
    if (!validation.valid) {
      return NextResponse.json(
        { ok: false, error: "validation_failed", violations: validation.violations },
        { status: 400 },
      )
    }
  }

  const { data, error } = await supabase
    .from("swap_requests")
    .update({ status: nextStatus(status, action), updated_at: new Date().toISOString() })
    .eq("id", swapId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    nextStatus: data.status,
    swap: data,
  })
}
