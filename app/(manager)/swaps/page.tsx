"use client"

import { useEffect, useState } from "react"
import type { SwapAction, SwapStatus } from "@/lib/swaps/state-machine"
import type { DropAction, DropStatus } from "@/lib/drops/state-machine"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

const sampleSwap = {
  id: "swap-1",
  requestedBy: "staff1@shiftsync.dev",
  targetUser: "staff4@shiftsync.dev",
  status: "pending_manager" as SwapStatus,
  reason: "Need to swap due to appointment.",
}

const actions: SwapAction[] = ["approve", "reject", "cancel"]

export default function ManagerSwapsPage() {
  const [status, setStatus] = useState<SwapStatus>(sampleSwap.status)
  const [message, setMessage] = useState<string>("")
  const [dropStatus, setDropStatus] = useState<DropStatus>("claimed")
  const [dropMessage, setDropMessage] = useState<string>("")
  const [realtimeNotice, setRealtimeNotice] = useState<string>("")

  const handleAction = async (action: SwapAction) => {
    setMessage("")
    const response = await fetch("/api/swaps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        status,
        swapId: "swap-1",
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      setMessage(data.message ?? "Swap action failed.")
      return
    }
    setStatus(data.nextStatus)
    setMessage(`Status updated to ${data.nextStatus}.`)
  }

  const handleDropAction = async (action: DropAction) => {
    setDropMessage("")
    const response = await fetch("/api/drop-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        status: dropStatus,
        dropId: "drop-2",
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      setDropMessage(data.message ?? "Drop action failed.")
      return
    }
    setDropStatus(data.nextStatus)
    setDropMessage(`Status updated to ${data.nextStatus}.`)
  }

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Swap Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Review swap requests and enforce the guarded workflow.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-background p-5">
        <div className="flex flex-col gap-2">
          <div className="text-sm text-muted-foreground">Request</div>
          <div className="text-lg font-semibold">{sampleSwap.id}</div>
          <div className="text-sm">
            {sampleSwap.requestedBy} → {sampleSwap.targetUser}
          </div>
          <div className="text-sm text-muted-foreground">{sampleSwap.reason}</div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              onClick={() => handleAction(action)}
            >
              {action}
            </button>
          ))}
          <span className="rounded-full border border-border px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
            {status}
          </span>
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
        <div className="flex flex-col gap-2">
          <div className="text-sm text-muted-foreground">Drop approval</div>
          <div className="text-lg font-semibold">drop-2</div>
          <div className="text-sm text-muted-foreground">Claimed by staff2@shiftsync.dev</div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={() => handleDropAction("approve")}
          >
            Approve drop
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={() => handleDropAction("reject")}
          >
            Reject drop
          </button>
          <span className="rounded-full border border-border px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
            {dropStatus}
          </span>
        </div>

        {dropMessage && (
          <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {dropMessage}
          </div>
        )}
      </section>
    </main>
  )
}
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel("manager-swap-drop-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "swap_requests" },
        () => {
          setRealtimeNotice("Swap request updated in realtime.")
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drop_requests" },
        () => {
          setRealtimeNotice("Drop request updated in realtime.")
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])
