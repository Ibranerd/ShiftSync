"use client"

import { useEffect, useMemo, useState } from "react"
import { formatInTimeZone, toZonedTime } from "date-fns-tz"
import { calculateFairnessScores, type FairnessInput } from "@/lib/fairness"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

type AssignmentRow = {
  user_id: string
  shifts: { start_utc: string; end_utc: string; location_id: string; locations: { timezone: string } | null } | null
}

type UserRow = {
  id: string
  full_name: string
  desired_weekly_hours: number | null
}

function isPremiumShift(startUtc: string, timezone: string) {
  const zoned = toZonedTime(new Date(startUtc), timezone)
  const day = zoned.getDay()
  const hour = zoned.getHours()
  const isWeekend = day === 5 || day === 6
  return isWeekend && hour >= 17
}

export default function AdminFairnessPage() {
  const [startDate, setStartDate] = useState<string>(() => {
    const now = new Date()
    const prior = new Date(now)
    prior.setDate(now.getDate() - 28)
    return prior.toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [scores, setScores] = useState<Array<{ userId: string; totalHours: number; premiumShiftCount: number; score: number }>>(
    [],
  )
  const [users, setUsers] = useState<UserRow[]>([])
  const [status, setStatus] = useState("Loading fairness metrics...")

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const load = async () => {
      const { data: userRows } = await supabase.from("users").select("id,full_name,desired_weekly_hours").eq("role", "staff")
      setUsers((userRows ?? []) as UserRow[])

      const { data: assignments, error } = await supabase
        .from("shift_assignments")
        .select("user_id,shifts:shifts (start_utc,end_utc,location_id,locations:locations (timezone))")
        .neq("status", "dropped")
        .gte("shifts.start_utc", `${startDate}T00:00:00.000Z`)
        .lte("shifts.start_utc", `${endDate}T23:59:59.999Z`)

      if (error) {
        setStatus("Unable to load fairness data.")
        return
      }

      const inputs: FairnessInput[] = (assignments ?? []).map((row: AssignmentRow) => {
        const timezone = row.shifts?.locations?.timezone ?? "UTC"
        const hours =
          row.shifts?.start_utc && row.shifts?.end_utc
            ? (new Date(row.shifts.end_utc).getTime() - new Date(row.shifts.start_utc).getTime()) / (1000 * 60 * 60)
            : 0
        return {
          userId: row.user_id,
          hours,
          premiumShifts: row.shifts?.start_utc ? (isPremiumShift(row.shifts.start_utc, timezone) ? 1 : 0) : 0,
        }
      })

      setScores(calculateFairnessScores(inputs))
      setStatus("")
    }

    void load()
  }, [endDate, startDate])

  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users])

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Fairness Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Distribution of hours and premium shifts across staff.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-background p-5">
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Start date</label>
            <input
              type="date"
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">End date</label>
            <input
              type="date"
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
          <div className="flex items-end">
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Range: {formatInTimeZone(new Date(startDate), "UTC", "MMM d, yyyy")} →{" "}
              {formatInTimeZone(new Date(endDate), "UTC", "MMM d, yyyy")}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-5">
        {status ? (
          <p className="text-sm text-muted-foreground">{status}</p>
        ) : scores.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assignments in range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Staff member</th>
                  <th className="px-4 py-3 text-left">Total hours</th>
                  <th className="px-4 py-3 text-left">Premium shifts</th>
                  <th className="px-4 py-3 text-left">Desired hours</th>
                  <th className="px-4 py-3 text-left">Fairness score</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((score) => {
                  const user = userMap.get(score.userId)
                  return (
                    <tr key={score.userId} className="border-t border-border">
                      <td className="px-4 py-3">{user?.full_name ?? score.userId}</td>
                      <td className="px-4 py-3">{score.totalHours.toFixed(1)} hrs</td>
                      <td className="px-4 py-3">{score.premiumShiftCount}</td>
                      <td className="px-4 py-3">
                        {(user?.desired_weekly_hours ?? 0).toFixed(1)} hrs
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${Math.max(0, Math.min(100, score.score))}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">{score.score.toFixed(0)}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
