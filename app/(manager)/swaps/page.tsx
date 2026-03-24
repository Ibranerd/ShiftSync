"use client"

import { useEffect, useState } from "react"
import { formatInTimeZone } from "date-fns-tz"
import type { SwapAction, SwapStatus } from "@/lib/swaps/state-machine"
import type { DropAction, DropStatus } from "@/lib/drops/state-machine"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

type SwapRow = {
  id: string
  assignment_id: string | null
  shift_id: string
  requested_by: string
  target_user_id: string
  status: SwapStatus
  reason: string | null
  shifts: {
    start_utc: string
    end_utc: string
    location_id: string
    locations: { timezone: string; name: string } | null
  } | null
}

type DropRow = {
  id: string
  assignment_id: string | null
  shift_id: string
  requested_by: string
  claimed_by: string | null
  status: DropStatus
  reason: string | null
  shifts: {
    start_utc: string
    end_utc: string
    location_id: string
    locations: { timezone: string; name: string } | null
  } | null
}

const actions: SwapAction[] = ["approve", "reject", "cancel"]

export default function ManagerSwapsPage() {
  const [swapRequests, setSwapRequests] = useState<SwapRow[]>([])
  const [dropRequests, setDropRequests] = useState<DropRow[]>([])
  const [message, setMessage] = useState<string>("")
  const [dropMessage, setDropMessage] = useState<string>("")
  const [realtimeNotice, setRealtimeNotice] = useState<string>("")
  const [swapCount, setSwapCount] = useState(0)
  const [dropCount, setDropCount] = useState(0)

  const formatSwapError = (error: string | undefined, fallback: string) => {
    switch (error) {
      case "invalid_transition":
        return "That swap action is no longer valid."
      case "conflict":
      case "assignment_conflict":
        return "This swap was just handled by someone else. Refresh to see the latest status."
      case "forbidden":
        return "You are not authorized to approve swaps for this location."
      case "swap_not_found":
        return "Swap request not found."
      default:
        return fallback
    }
  }

  const formatDropError = (error: string | undefined, fallback: string) => {
    switch (error) {
      case "invalid_transition":
        return "That drop action is no longer valid."
      case "conflict":
      case "assignment_conflict":
        return "This drop was just handled by someone else. Refresh to see the latest status."
      case "forbidden":
        return "You are not authorized to approve drops for this location."
      case "drop_not_found":
        return "Drop request not found."
      case "missing_claimed_by":
        return "Drop must be claimed before approval."
      default:
        return fallback
    }
  }

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const load = async () => {
      const [swapRes, dropRes] = await Promise.all([
        supabase
          .from("swap_requests")
          .select(
            "id,assignment_id,shift_id,requested_by,target_user_id,status,reason,shifts:shifts (start_utc,end_utc,location_id,locations:locations (timezone,name))",
          )
          .in("status", ["pending_manager", "pending_staff"])
          .order("created_at", { ascending: false }),
        supabase
          .from("drop_requests")
          .select(
            "id,assignment_id,shift_id,requested_by,claimed_by,status,reason,shifts:shifts (start_utc,end_utc,location_id,locations:locations (timezone,name))",
          )
          .in("status", ["claimed", "pending"])
          .order("created_at", { ascending: false }),
      ])

      setSwapRequests((swapRes.data ?? []) as SwapRow[])
      setDropRequests((dropRes.data ?? []) as DropRow[])
      setSwapCount(swapRes.data?.length ?? 0)
      setDropCount(dropRes.data?.length ?? 0)
    }

    void load()

    const channel = supabase
      .channel("manager-swap-drop-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "swap_requests" },
        () => {
          setRealtimeNotice("Swap request updated in realtime.")
          void load()
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drop_requests" },
        () => {
          setRealtimeNotice("Drop request updated in realtime.")
          void load()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const handleAction = async (swap: SwapRow, action: SwapAction) => {
    setMessage("")
    const response = await fetch("/api/swaps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        status: swap.status,
        swapId: swap.id,
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      setMessage(formatSwapError(data.error, data.message ?? "Swap action failed."))
      return
    }
  }

  const handleDropAction = async (drop: DropRow, action: DropAction) => {
    setDropMessage("")
    const response = await fetch("/api/drop-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        status: drop.status,
        dropId: drop.id,
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      setDropMessage(formatDropError(data.error, data.message ?? "Drop action failed."))
      return
    }
  }

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Swap Approvals</h1>
        <p className="text-sm text-muted-foreground">Review swap requests and enforce the guarded workflow.</p>
      </div>

      <section className="rounded-lg border border-border bg-background p-5">
        <div className="text-xs text-muted-foreground">
          Pending swaps: {swapCount} · Pending drops: {dropCount}
        </div>
        <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Approved swaps/drops update assignments immediately. Any later shift edits apply to the new assignee and are logged with notifications.
        </div>
        {message && (
          <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {message}
          </div>
        )}
        {swapRequests.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No swap requests awaiting approval.</p>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            {swapRequests.map((swap) => (
              <div key={swap.id} className="rounded-md border border-border bg-muted/10 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{swap.id}</div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                    {swap.status}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {swap.requested_by} → {swap.target_user_id}
                </div>
                <div className="text-xs text-muted-foreground">
                  Assignment {swap.assignment_id ?? "n/a"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Shift {swap.shift_id} · Location {swap.shifts?.locations?.name ?? swap.shifts?.location_id ?? "unknown"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {swap.shifts?.start_utc && swap.shifts?.end_utc
                    ? `${formatInTimeZone(new Date(swap.shifts.start_utc), swap.shifts.locations?.timezone ?? "UTC", "MMM d, h:mm a")} → ${formatInTimeZone(new Date(swap.shifts.end_utc), swap.shifts.locations?.timezone ?? "UTC", "MMM d, h:mm a")}`
                    : "Unknown time"}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {actions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                      onClick={() => handleAction(swap, action)}
                    >
                      {action}
                    </button>
                  ))}
                </div>
                {(swap.status === "cancelled" || swap.status === "expired") && (
                  <div className="mt-2 text-xs text-amber-600">
                    This request was closed after a schedule update.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {realtimeNotice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {realtimeNotice}
        </div>
      )}

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">Drop approvals</h2>
        {dropMessage && (
          <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {dropMessage}
          </div>
        )}
        {dropRequests.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No drop requests awaiting approval.</p>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            {dropRequests.map((drop) => (
              <div key={drop.id} className="rounded-md border border-border bg-muted/10 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{drop.id}</div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                    {drop.status}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Requested by {drop.requested_by}
                  {drop.claimed_by ? ` · Claimed by ${drop.claimed_by}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  Assignment {drop.assignment_id ?? "n/a"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Shift {drop.shift_id} · Location {drop.shifts?.locations?.name ?? drop.shifts?.location_id ?? "unknown"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {drop.shifts?.start_utc && drop.shifts?.end_utc
                    ? `${formatInTimeZone(new Date(drop.shifts.start_utc), drop.shifts.locations?.timezone ?? "UTC", "MMM d, h:mm a")} → ${formatInTimeZone(new Date(drop.shifts.end_utc), drop.shifts.locations?.timezone ?? "UTC", "MMM d, h:mm a")}`
                    : "Unknown time"}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                    onClick={() => handleDropAction(drop, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                    onClick={() => handleDropAction(drop, "reject")}
                  >
                    Reject
                  </button>
                </div>
                {(drop.status === "cancelled" || drop.status === "expired") && (
                  <div className="mt-2 text-xs text-amber-600">
                    This request was closed after a schedule update.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
