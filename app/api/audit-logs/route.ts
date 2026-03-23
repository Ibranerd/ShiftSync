import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const start = searchParams.get("start")
  const end = searchParams.get("end")
  const locationId = searchParams.get("location_id")

  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from("audit_logs")
    .select("entity_type,entity_id,changed_by,changed_at,before_json,after_json")
    .order("changed_at", { ascending: false })

  if (start) {
    query = query.gte("changed_at", start)
  }
  if (end) {
    query = query.lte("changed_at", end)
  }

  if (locationId) {
    const { data: shiftRows } = await supabase
      .from("shifts")
      .select("id")
      .eq("location_id", locationId)
    const shiftIds = (shiftRows ?? []).map((row) => row.id)
    if (shiftIds.length > 0) {
      query = query.in("entity_id", shiftIds)
    } else {
      query = query.in("entity_id", ["00000000-0000-0000-0000-000000000000"])
    }
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const header = ["entity_type", "entity_id", "changed_by", "changed_at", "before_json", "after_json"]
  const rows = (data ?? []).map((row) =>
    header
      .map((key) => {
        const value = row[key as keyof typeof row]
        if (value === null || value === undefined) return ""
        if (typeof value === "object") return JSON.stringify(value).replaceAll('"', '""')
        return String(value).replaceAll('"', '""')
      })
      .map((value) => `"${value}"`)
      .join(","),
  )

  const csv = [header.join(","), ...rows].join("\n")

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="audit_logs.csv"',
    },
  })
}
