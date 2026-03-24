"use client"

import { useEffect, useState } from "react"
import { formatInTimeZone } from "date-fns-tz"
import type { SwapAction, SwapStatus } from "@/lib/swaps/state-machine"
import type { DropAction, DropStatus } from "@/lib/drops/state-machine"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

type SwapRow = {
  id: string
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

export default function StaffSwapRequestsPage() {
  const [swapRequests, setSwapRequests] = useState<SwapRow[]>([])
  const [dropRequests, setDropRequests] = useState<DropRow[]>([])
  const [message, setMessage] = useState<string>("")
  const [dropMessage, setDropMessage] = useState<string>("")
  const [realtimeNotice, setRealtimeNotice] = useState<string>("")
  const [swapCount, setSwapCount] = useState(0)
  const [dropCount, setDropCount] = useState(0)
  const [swapShiftId, setSwapShiftId] = useState("")
  const [swapTargetId, setSwapTargetId] = useState("")
  const [dropShiftId, setDropShiftId] = useState("")
  const [currentUserId, setCurrentUserId] = useState<string>("")
  const [availableDrops, setAvailableDrops] = useState<DropRow[]>([])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const load = async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) return
      setCurrentUserId(userData.user.id)

      const [swapRes, dropRes, availableRes] = await Promise.all([
        supabase
          .from("swap_requests")
          .select(
            "id,shift_id,requested_by,target_user_id,status,reason,shifts:shifts (start_utc,end_utc,location_id,is_published,locations:locations (timezone,name))",
          )
          .or(`requested_by.eq.${userData.user.id},target_user_id.eq.${userData.user.id}`)
          .order("created_at", { ascending: false }),
        supabase
          .from("drop_requests")
          .select(
            "id,shift_id,requested_by,claimed_by,status,reason,shifts:shifts (start_utc,end_utc,location_id,is_published,locations:locations (timezone,name))",
          )
          .eq("requested_by", userData.user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("drop_requests")
          .select(
            "id,shift_id,requested_by,claimed_by,status,reason,shifts:shifts (start_utc,end_utc,location_id,is_published,locations:locations (timezone,name))",
          )
          .eq("status", "pending")
          .neq("requested_by", userData.user.id)
          .order("created_at", { ascending: false }),
      ])

      const publishedSwaps = (swapRes.data ?? []).filter((row: any) => row.shifts?.is_published)
      const publishedDrops = (dropRes.data ?? []).filter((row: any) => row.shifts?.is_published)
      const publishedAvailableDrops = (availableRes.data ?? []).filter((row: any) => row.shifts?.is_published)

      setSwapRequests(publishedSwaps as SwapRow[])
      setDropRequests(publishedDrops as DropRow[])
      setAvailableDrops(publishedAvailableDrops as DropRow[])
      setSwapCount(publishedSwaps.length)
      setDropCount(publishedDrops.length)
    }

    void load()

    const channel = supabase
      .channel("swap-drop-updates")
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

  const handleSwapAction = async (swap: SwapRow, action: SwapAction) => {
    if (action === "request" && swapCount >= 3) {
      setMessage("Swap limit reached (3 pending).")
      return
    }
    setMessage("")
    const response = await fetch("/api/swaps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        status: swap.status,
        swapId: swap.id,
        shiftId: swap.shift_id,
        targetUserId: swap.target_user_id,
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      setMessage(data.message ?? "Swap action failed.")
      return
    }
  }

  const handleCreateSwap = async () => {
    if (!swapShiftId || !swapTargetId) {
      setMessage("Enter shift and target user IDs.")
      return
    }
    setMessage("")
    const response = await fetch("/api/swaps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "request",
        status: "pending_staff",
        shiftId: swapShiftId,
        targetUserId: swapTargetId,
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      setMessage(data.message ?? "Swap request failed.")
      return
    }
  }

  const handleDropAction = async (drop: DropRow, action: DropAction) => {
    if (action === "request" && dropCount >= 3) {
      setDropMessage("Drop limit reached (3 pending).")
      return
    }
    setDropMessage("")
    const response = await fetch("/api/drop-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        status: drop.status,
        dropId: drop.id,
        shiftId: drop.shift_id,
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      setDropMessage(data.message ?? "Drop action failed.")
      return
    }
  }

  const handleCreateDrop = async () => {
    if (!dropShiftId) {
      setDropMessage("Enter a shift ID to drop.")
      return
    }
    setDropMessage("")
    const response = await fetch("/api/drop-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "request",
        status: "pending",
        shiftId: dropShiftId,
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      setDropMessage(data.message ?? "Drop request failed.")
      return
    }
  }

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Swap Requests</h1>
        <p className="text-sm text-muted-foreground">Request a swap and track approval state.</p>
      </div>

      <section className="rounded-lg border border-border bg-background p-5">
        <div className="mb-3 text-sm text-muted-foreground">
          Pending swaps: {swapCount} · Pending drops: {dropCount}
        </div>
        <div className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          After approval, assignments update immediately. If a shift is edited later, the new assignee keeps the shift and updates are logged and notified.
        </div>
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Shift ID</label>
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={swapShiftId}
              onChange={(event) => setSwapShiftId(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Target user ID</label>
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={swapTargetId}
              onChange={(event) => setSwapTargetId(event.target.value)}
            />
          </div>
        </div>
        <div className="mt-3">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={handleCreateSwap}
          >
            Create swap request
          </button>
        </div>
        {message && (
          <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {message}
          </div>
        )}
      </section>

      {realtimeNotice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {realtimeNotice}
        </div>
      )}

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">Your swap requests</h2>
        {swapRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No swap requests yet.</p>
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
                  Shift {swap.shift_id} · Location {swap.shifts?.locations?.name ?? swap.shifts?.location_id ?? "unknown"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {swap.shifts?.start_utc && swap.shifts?.end_utc
                    ? `${formatInTimeZone(new Date(swap.shifts.start_utc), swap.shifts.locations?.timezone ?? "UTC", "MMM d, h:mm a")} → ${formatInTimeZone(new Date(swap.shifts.end_utc), swap.shifts.locations?.timezone ?? "UTC", "MMM d, h:mm a")}`
                    : "Unknown time"}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {swap.status === "pending_staff" && swap.target_user_id === currentUserId && (
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                      onClick={() => handleSwapAction(swap, "accept")}
                    >
                      Accept
                    </button>
                  )}
                  {(swap.status === "pending_staff" || swap.status === "pending_manager") &&
                    swap.requested_by === currentUserId && (
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                        onClick={() => handleSwapAction(swap, "cancel")}
                      >
                        Cancel
                      </button>
                    )}
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

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">Drop requests</h2>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Shift ID</label>
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={dropShiftId}
              onChange={(event) => setDropShiftId(event.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              onClick={handleCreateDrop}
            >
              Create drop request
            </button>
          </div>
        </div>
        {dropMessage && (
          <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {dropMessage}
          </div>
        )}
        {dropRequests.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No drop requests yet.</p>
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
                  Shift {drop.shift_id} · Location {drop.shifts?.locations?.name ?? drop.shifts?.location_id ?? "unknown"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {drop.shifts?.start_utc && drop.shifts?.end_utc
                    ? `${formatInTimeZone(new Date(drop.shifts.start_utc), drop.shifts.locations?.timezone ?? "UTC", "MMM d, h:mm a")} → ${formatInTimeZone(new Date(drop.shifts.end_utc), drop.shifts.locations?.timezone ?? "UTC", "MMM d, h:mm a")}`
                    : "Unknown time"}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {(drop.status === "pending" || drop.status === "claimed") && drop.requested_by === currentUserId && (
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                      onClick={() => handleDropAction(drop, "cancel")}
                    >
                      Cancel
                    </button>
                  )}
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

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">Available drops to claim</h2>
        {availableDrops.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No open drops right now.</p>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            {availableDrops.map((drop) => (
              <div key={drop.id} className="rounded-md border border-border bg-muted/10 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{drop.id}</div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                    {drop.status}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Shift {drop.shift_id} · Location {drop.shifts?.locations?.name ?? drop.shifts?.location_id ?? "unknown"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {drop.shifts?.start_utc && drop.shifts?.end_utc
                    ? `${formatInTimeZone(new Date(drop.shifts.start_utc), drop.shifts.locations?.timezone ?? "UTC", "MMM d, h:mm a")} → ${formatInTimeZone(new Date(drop.shifts.end_utc), drop.shifts.locations?.timezone ?? "UTC", "MMM d, h:mm a")}`
                    : "Unknown time"}
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                    onClick={() => handleDropAction(drop, "claim")}
                  >
                    Claim drop
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
