import { NextResponse } from "next/server"
import { canDropTransition, nextDropStatus, type DropAction, type DropStatus } from "@/lib/drops/state-machine"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "drop-requests",
    actions: ["request", "claim", "approve", "reject", "cancel", "expire"],
  })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 })
  }

  const action = body.action as DropAction | undefined
  const status = body.status as DropStatus | undefined

  if (!action || !status) {
    return NextResponse.json({ ok: false, error: "missing_action_or_status" }, { status: 400 })
  }

  if (!canDropTransition(status, action)) {
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

  const dropId = body.dropId as string | undefined
  const shiftId = body.shiftId as string | undefined
  const reason = body.reason as string | undefined

  if (action === "request") {
    if (!shiftId) {
      return NextResponse.json({ ok: false, error: "missing_shift" }, { status: 400 })
    }
    const { count } = await supabase
      .from("drop_requests")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", userData.user.id)
      .in("status", ["pending", "claimed"])
    if ((count ?? 0) >= 3) {
      return NextResponse.json({ ok: false, error: "drop_limit_reached" }, { status: 400 })
    }
    const { data, error } = await supabase
      .from("drop_requests")
      .insert({
        shift_id: shiftId,
        requested_by: userData.user.id,
        status: "pending",
        reason: reason ?? null,
      })
      .select()
      .single()
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, nextStatus: data.status, drop: data })
  }

  if (!dropId) {
    return NextResponse.json({ ok: false, error: "missing_drop_id" }, { status: 400 })
  }

  const updatePayload: Record<string, unknown> = {
    status: nextDropStatus(status, action),
    updated_at: new Date().toISOString(),
  }
  if (action === "claim") {
    updatePayload.claimed_by = userData.user.id
  }

  const { data, error } = await supabase
    .from("drop_requests")
    .update(updatePayload)
    .eq("id", dropId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    nextStatus: data.status,
    drop: data,
  })
}
