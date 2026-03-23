import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const swapResult = await supabase.rpc("expire_swap_requests")
  const dropResult = await supabase.rpc("expire_drop_requests")

  if (swapResult.error || dropResult.error) {
    return NextResponse.json(
      {
        ok: false,
        swapError: swapResult.error?.message,
        dropError: dropResult.error?.message,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
