import { NextResponse } from "next/server"
import { validateAssignment } from "@/lib/constraint-engine"
import { loadAssignmentContext } from "@/lib/constraint-engine/server"
import { canTransition, nextStatus, type SwapAction, type SwapStatus } from "@/lib/swaps/state-machine"
import { getUserRole } from "@/lib/supabase/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function GET() {
  return NextResponse.json({ ok: true, route: "swaps", actions: ["request", "accept", "reject", "approve", "cancel", "expire"] })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload", message: "Request body is required." },
      { status: 400 },
    )
  }

  const action = body.action as SwapAction | undefined
  const status = body.status as SwapStatus | undefined

  if (!action || !status) {
    return NextResponse.json(
      { ok: false, error: "missing_action_or_status", message: "Action and status are required." },
      { status: 400 },
    )
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
    return NextResponse.json(
      { ok: false, error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    )
  }

  const swapId = body.swapId as string | undefined
  const assignmentId = body.assignmentId as string | undefined
  const targetUserId = body.targetUserId as string | undefined
  const reason = body.reason as string | undefined

  if (action === "request") {
    if (!assignmentId || !targetUserId) {
      return NextResponse.json(
        { ok: false, error: "missing_assignment_or_target", message: "Assignment and target staff are required." },
        { status: 400 },
      )
    }
    const { data: assignmentRow, error: assignmentError } = await supabase
      .from("shift_assignments")
      .select("id,shift_id,user_id,status")
      .eq("id", assignmentId)
      .single()
    if (assignmentError || !assignmentRow) {
      return NextResponse.json(
        { ok: false, error: "assignment_not_found", message: "Assignment not found." },
        { status: 404 },
      )
    }
    if (assignmentRow.user_id !== userData.user.id || assignmentRow.status === "dropped") {
      return NextResponse.json(
        { ok: false, error: "assignment_not_owned", message: "You can only swap your own active assignment." },
        { status: 403 },
      )
    }
    const resolvedShiftId = assignmentRow.shift_id
    const { context, error: contextError } = await loadAssignmentContext(supabase, targetUserId, resolvedShiftId)
    if (contextError || !context) {
      return NextResponse.json(
        { ok: false, error: contextError ?? "shift_not_found", message: "Shift not found." },
        { status: 404 },
      )
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
        { ok: false, error: "validation_failed", message: "Target staff is not eligible.", violations: validation.violations },
        { status: 400 },
      )
    }
    const { count } = await supabase
      .from("swap_requests")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", userData.user.id)
      .in("status", ["pending_staff", "pending_manager"])
    if ((count ?? 0) >= 3) {
      return NextResponse.json(
        { ok: false, error: "swap_limit_reached", message: "Swap request limit reached." },
        { status: 400 },
      )
    }
    const { data, error } = await supabase
      .from("swap_requests")
      .insert({
        shift_id: resolvedShiftId,
        assignment_id: assignmentId,
        requested_by: userData.user.id,
        target_user_id: targetUserId,
        status: "pending_staff",
        reason: reason ?? null,
      })
      .select()
      .single()
    if (error) {
      return NextResponse.json({ ok: false, error: "swap_create_failed", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, nextStatus: data.status, swap: data })
  }

  if (!swapId) {
    return NextResponse.json({ ok: false, error: "missing_swap_id", message: "Swap id is required." }, { status: 400 })
  }

  const { data: swapRow, error: swapError } = await supabase
    .from("swap_requests")
    .select("id,shift_id,assignment_id,requested_by,target_user_id,status")
    .eq("id", swapId)
    .single()

  if (swapError || !swapRow) {
    return NextResponse.json({ ok: false, error: "swap_not_found", message: "Swap not found." }, { status: 404 })
  }

  if ((action === "accept" || action === "approve") && swapRow.target_user_id) {
    const { context, error: contextError } = await loadAssignmentContext(
      supabase,
      swapRow.target_user_id,
      swapRow.shift_id,
    )
    if (contextError || !context) {
      return NextResponse.json(
        { ok: false, error: contextError ?? "shift_not_found", message: "Shift not found." },
        { status: 404 },
      )
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
        { ok: false, error: "validation_failed", message: "Target staff is not eligible.", violations: validation.violations },
        { status: 400 },
      )
    }
  }

  if (action === "approve" || action === "reject") {
    const { data: lockOk, error: lockError } = await supabase.rpc("lock_swap_approval", { p_swap_id: swapId })
    if (lockError) {
      return NextResponse.json({ ok: false, error: "lock_failed", message: lockError.message }, { status: 500 })
    }
    if (!lockOk) {
      return NextResponse.json(
        { ok: false, error: "conflict", message: "Swap is being handled by another manager." },
        { status: 409 },
      )
    }

    const role = getUserRole(userData.user)
    if (role !== "admin" && role !== "manager") {
      return NextResponse.json({ ok: false, error: "forbidden", message: "Manager access required." }, { status: 403 })
    }
    if (role === "manager") {
      const { data: shiftRow, error: shiftError } = await supabase
        .from("shifts")
        .select("location_id")
        .eq("id", swapRow.shift_id)
        .single()
      if (shiftError || !shiftRow) {
        return NextResponse.json({ ok: false, error: "shift_not_found", message: "Shift not found." }, { status: 404 })
      }
      const { count } = await supabase
        .from("location_managers")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", userData.user.id)
        .eq("location_id", shiftRow.location_id)
      if ((count ?? 0) === 0) {
        return NextResponse.json({ ok: false, error: "forbidden", message: "Not authorized for this location." }, { status: 403 })
      }
    }
  }

  if (action === "approve") {
    if (!swapRow.target_user_id) {
      return NextResponse.json(
        { ok: false, error: "missing_target_user", message: "Swap target is required." },
        { status: 400 },
      )
    }
    if (!swapRow.assignment_id) {
      return NextResponse.json(
        { ok: false, error: "missing_assignment", message: "Swap assignment is required." },
        { status: 400 },
      )
    }
    const { data: updatedAssignments, error: updateError } = await supabase
      .from("shift_assignments")
      .update({
        user_id: swapRow.target_user_id,
        assigned_by: userData.user.id,
      })
      .eq("id", swapRow.assignment_id)
      .eq("user_id", swapRow.requested_by)
      .neq("status", "dropped")
      .select()

    if (updateError) {
      return NextResponse.json({ ok: false, error: "assignment_update_failed", message: updateError.message }, { status: 500 })
    }

    if (!updatedAssignments || updatedAssignments.length === 0) {
      return NextResponse.json(
        { ok: false, error: "assignment_conflict", message: "Assignment slot is no longer available." },
        { status: 409 },
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
    return NextResponse.json({ ok: false, error: "swap_update_failed", message: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    nextStatus: data.status,
    swap: data,
  })
}
