import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getUserRole } from "@/lib/supabase/auth"

export async function GET() {
  return NextResponse.json({ ok: true, route: "shifts" })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 })
  }

  const action =
    (body.action as
      | "publish"
      | "unpublish"
      | "create"
      | "publish_week"
      | "unpublish_week"
      | "update"
      | undefined)
  const shiftId = body.shiftId as string | undefined
  const overrideReason = body.overrideReason as string | undefined

  if (!action || !shiftId) {
    if (action !== "create") {
      return NextResponse.json({ ok: false, error: "missing_action_or_shift" }, { status: 400 })
    }
  }

  const supabase = await createSupabaseServerClient()

  if (action === "create") {
    const payload = body.shift
    if (!payload?.location_id || !payload?.start_utc || !payload?.end_utc) {
      return NextResponse.json({ ok: false, error: "missing_shift_payload" }, { status: 400 })
    }
    if (!Array.isArray(payload.required_skill_ids) || payload.required_skill_ids.length === 0) {
      return NextResponse.json({ ok: false, error: "missing_required_skills" }, { status: 400 })
    }
    if (typeof payload.headcount_needed !== "number" || payload.headcount_needed < 1) {
      return NextResponse.json({ ok: false, error: "invalid_headcount" }, { status: 400 })
    }

    const { error: insertError, data } = await supabase
      .from("shifts")
      .insert({
        location_id: payload.location_id,
        start_utc: payload.start_utc,
        end_utc: payload.end_utc,
        required_skill_ids: payload.required_skill_ids ?? [],
        headcount_needed: payload.headcount_needed ?? 1,
        is_published: payload.is_published ?? false,
      })
      .select()
      .single()

    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, shift: data })
  }

  if (action === "update") {
    const payload = body.shift
    if (!shiftId || !payload?.start_utc || !payload?.end_utc) {
      return NextResponse.json({ ok: false, error: "missing_shift_payload" }, { status: 400 })
    }
    const { error: updateError, data } = await supabase
      .from("shifts")
      .update({
        start_utc: payload.start_utc,
        end_utc: payload.end_utc,
        required_skill_ids: payload.required_skill_ids ?? [],
        headcount_needed: payload.headcount_needed ?? 1,
        is_published: payload.is_published ?? false,
      })
      .eq("id", shiftId)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, shift: data })
  }

  if (action === "publish_week" || action === "unpublish_week") {
    const weekStart = body.weekStart as string | undefined
    if (!weekStart) {
      return NextResponse.json({ ok: false, error: "missing_week_start" }, { status: 400 })
    }
    const weekStartDate = new Date(weekStart)
    const weekEndDate = new Date(weekStartDate)
    weekEndDate.setDate(weekStartDate.getDate() + 7)

    const { error: updateError } = await supabase
      .from("shifts")
      .update({ is_published: action === "publish_week" })
      .gte("start_utc", weekStartDate.toISOString())
      .lt("start_utc", weekEndDate.toISOString())

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, action })
  }
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("id,start_utc,publish_cutoff_hours,is_published")
    .eq("id", shiftId)
    .single()

  if (error || !shift) {
    return NextResponse.json({ ok: false, error: "shift_not_found" }, { status: 404 })
  }

  const cutoffHours = shift.publish_cutoff_hours ?? 48
  const cutoffTime = new Date(shift.start_utc).getTime() - cutoffHours * 60 * 60 * 1000
  const now = Date.now()

  if (now > cutoffTime && action === "unpublish") {
    const { data: authData } = await supabase.auth.getUser()
    const role = getUserRole(authData.user)
    if (role !== "admin") {
      return NextResponse.json(
        {
          ok: false,
          error: "cutoff_passed",
          message: "Publish cutoff has passed. Admin override required.",
        },
        { status: 403 },
      )
    }
    if (!overrideReason) {
      return NextResponse.json(
        {
          ok: false,
          error: "override_reason_required",
          message: "Admin override requires a reason.",
        },
        { status: 400 },
      )
    }
  }

  const { error: updateError } = await supabase
    .from("shifts")
    .update({ is_published: action === "publish", override_reason: overrideReason ?? null })
    .eq("id", shiftId)

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, shiftId, action })
}
