"use client"

import { useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

export default function AuditLogsPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [locationId, setLocationId] = useState("")
  const [rows, setRows] = useState<Array<{ id: string; entity_type: string; entity_id: string; changed_at: string }>>([])
  const [status, setStatus] = useState("Loading audit logs...")

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const load = async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id,entity_type,entity_id,changed_at")
        .order("changed_at", { ascending: false })
        .limit(20)
      if (error) {
        setStatus("Unable to load audit logs.")
        return
      }
      setRows((data ?? []) as any)
      setStatus("")
    }
    void load()
  }, [])
  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audit Logs</h1>
          <p className="text-sm text-muted-foreground">
            Review changes and export as CSV.
          </p>
        </div>
        <a
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          href={`/api/audit-logs?start=${startDate}T00:00:00Z&end=${endDate}T23:59:59Z&location_id=${locationId}`}
        >
          Download CSV
        </a>
      </div>

      <section className="rounded-lg border border-border bg-background p-5">
        <form className="mb-4 grid gap-3 text-sm md:grid-cols-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Start date</label>
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">End date</label>
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Location ID</label>
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              placeholder="location uuid"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            />
          </div>
        </form>
        {status ? (
          <p className="text-sm text-muted-foreground">{status}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit logs yet.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {rows.map((row) => (
              <div key={row.id} className="rounded-md border border-border bg-muted/20 p-3">
                <div className="font-medium">{row.entity_type}</div>
                <div className="text-muted-foreground">Entity: {row.entity_id}</div>
                <div className="text-xs text-muted-foreground">{row.changed_at}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
