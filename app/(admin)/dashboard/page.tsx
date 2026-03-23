"use client"

import { useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { Users, MapPin, CalendarClock, ClipboardList } from "lucide-react"

type Assignment = {
  id: string
  user_id: string
  shift_id: string
  status: string
  shifts: {
    location_id: string
    start_utc: string
    end_utc: string
  } | null
}

export default function AdminDashboardPage() {
  const [status, setStatus] = useState("Loading on-duty assignments...")
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [locations, setLocations] = useState<Array<{ id: string; name: string; timezone: string }>>([])
  const [users, setUsers] = useState<Array<{ id: string; full_name: string; role: string }>>([])
  const [shifts, setShifts] = useState<Array<{ id: string; location_id: string; start_utc: string; end_utc: string }>>([])
  const [assignmentRows, setAssignmentRows] = useState<Array<{ id: string; user_id: string; shift_id: string; status: string }>>([])
  const [metaStatus, setMetaStatus] = useState("Loading admin data...")
  const [activeTab, setActiveTab] = useState<"locations" | "users" | "shifts" | "assignments">("locations")

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()

    const load = async () => {
      const now = new Date().toISOString()
      const { data, error } = await supabase
        .from("shift_assignments")
        .select("id,user_id,shift_id,status,shifts:shifts (location_id,start_utc,end_utc)")
        .neq("status", "dropped")
        .lte("shifts.start_utc", now)
        .gte("shifts.end_utc", now)

      if (error) {
        setStatus("Unable to load on-duty assignments.")
        return
      }

      setAssignments((data ?? []) as Assignment[])
      setStatus("")
    }

    const loadMeta = async () => {
      const [locRes, userRes, shiftRes, assignRes] = await Promise.all([
        supabase.from("locations").select("id,name,timezone"),
        supabase.from("users").select("id,full_name,role"),
        supabase.from("shifts").select("id,location_id,start_utc,end_utc").limit(20),
        supabase.from("shift_assignments").select("id,user_id,shift_id,status").limit(20),
      ])

      if (locRes.error || userRes.error || shiftRes.error || assignRes.error) {
        setMetaStatus("Unable to load admin lists.")
        return
      }

      setLocations((locRes.data ?? []) as any)
      setUsers((userRes.data ?? []) as any)
      setShifts((shiftRes.data ?? []) as any)
      setAssignmentRows((assignRes.data ?? []) as any)
      setMetaStatus("")
    }

    void load()
    void loadMeta()

    const channel = supabase
      .channel("on-duty-assignments")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shift_assignments" },
        () => {
          void load()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Live view of on-duty staff across locations.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-background p-5">
        {status ? (
          <p className="text-sm text-muted-foreground">{status}</p>
        ) : assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active assignments.</p>
        ) : (
          <div className="space-y-3 text-sm">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="rounded-md border border-border bg-muted/20 p-3">
                <div className="font-medium">Assignment {assignment.id}</div>
                <div className="text-muted-foreground">
                  User: {assignment.user_id} · Location: {assignment.shifts?.location_id ?? "unknown"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {assignment.shifts?.start_utc} → {assignment.shifts?.end_utc}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Admin Data</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              className={`rounded-full border px-3 py-1 ${
                activeTab === "locations" ? "border-foreground text-foreground" : "border-border text-muted-foreground"
              }`}
              onClick={() => setActiveTab("locations")}
            >
              Locations
            </button>
            <button
              type="button"
              className={`rounded-full border px-3 py-1 ${
                activeTab === "users" ? "border-foreground text-foreground" : "border-border text-muted-foreground"
              }`}
              onClick={() => setActiveTab("users")}
            >
              Users
            </button>
            <button
              type="button"
              className={`rounded-full border px-3 py-1 ${
                activeTab === "shifts" ? "border-foreground text-foreground" : "border-border text-muted-foreground"
              }`}
              onClick={() => setActiveTab("shifts")}
            >
              Shifts
            </button>
            <button
              type="button"
              className={`rounded-full border px-3 py-1 ${
                activeTab === "assignments" ? "border-foreground text-foreground" : "border-border text-muted-foreground"
              }`}
              onClick={() => setActiveTab("assignments")}
            >
              Assignments
            </button>
          </div>
        </div>
        {metaStatus ? (
          <p className="text-sm text-muted-foreground">{metaStatus}</p>
        ) : (
          <div className="mt-4 rounded-lg border border-border bg-muted/10">
            {activeTab === "locations" && (
              <div>
                <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  Locations
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left">Name</th>
                        <th className="px-4 py-3 text-left">Timezone</th>
                        <th className="px-4 py-3 text-left">Location ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locations.map((location) => (
                        <tr key={location.id} className="border-t border-border">
                          <td className="px-4 py-3">{location.name}</td>
                          <td className="px-4 py-3">{location.timezone}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{location.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "users" && (
              <div>
                <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Users
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left">Name</th>
                        <th className="px-4 py-3 text-left">Role</th>
                        <th className="px-4 py-3 text-left">User ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id} className="border-t border-border">
                          <td className="px-4 py-3">{user.full_name}</td>
                          <td className="px-4 py-3">{user.role}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{user.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "shifts" && (
              <div>
                <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  Shifts (latest 20)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left">Shift ID</th>
                        <th className="px-4 py-3 text-left">Location ID</th>
                        <th className="px-4 py-3 text-left">Start</th>
                        <th className="px-4 py-3 text-left">End</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shifts.map((shift) => (
                        <tr key={shift.id} className="border-t border-border">
                          <td className="px-4 py-3 text-xs text-muted-foreground">{shift.id}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{shift.location_id}</td>
                          <td className="px-4 py-3">{shift.start_utc}</td>
                          <td className="px-4 py-3">{shift.end_utc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "assignments" && (
              <div>
                <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  Assignments (latest 20)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left">Assignment ID</th>
                        <th className="px-4 py-3 text-left">User ID</th>
                        <th className="px-4 py-3 text-left">Shift ID</th>
                        <th className="px-4 py-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignmentRows.map((row) => (
                        <tr key={row.id} className="border-t border-border">
                          <td className="px-4 py-3 text-xs text-muted-foreground">{row.id}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{row.user_id}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{row.shift_id}</td>
                          <td className="px-4 py-3">{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
