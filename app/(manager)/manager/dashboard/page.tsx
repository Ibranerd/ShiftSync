"use client"

import { useEffect, useMemo, useState } from "react"
import { formatInTimeZone } from "date-fns-tz"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

type Assignment = {
  id: string
  user_id: string
  user_name: string
  shift_id: string
  status: string
  shifts: {
    location_id: string
    start_utc: string
    end_utc: string
    locations?: { name: string | null; timezone?: string | null } | null
  } | null
}

type LocationRow = {
  id: string
  name: string
  timezone: string
}

export default function ManagerDashboardPage() {
  const [status, setStatus] = useState("Loading on-duty assignments...")
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [managedLocationIds, setManagedLocationIds] = useState<string[]>([])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()

    const loadManagerLocations = async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        setStatus("Please sign in to view on-duty staff.")
        return
      }

      const { data: managerRows, error: managerError } = await supabase
        .from("location_managers")
        .select("location_id")
        .eq("user_id", userData.user.id)

      if (managerError) {
        setStatus("Unable to load manager locations.")
        return
      }

      const locationIds = (managerRows ?? []).map((row: any) => row.location_id)
      setManagedLocationIds(locationIds)

      if (locationIds.length === 0) {
        setStatus("No managed locations assigned.")
        setAssignments([])
        setLocations([])
        return
      }

      const { data: locationRows } = await supabase
        .from("locations")
        .select("id,name,timezone")
        .in("id", locationIds)

      setLocations((locationRows ?? []) as LocationRow[])
    }

    void loadManagerLocations()
  }, [])

  useEffect(() => {
    if (managedLocationIds.length === 0) return
    const supabase = createSupabaseBrowserClient()

    const load = async () => {
      const now = new Date().toISOString()
      const { data: assignmentRows, error } = await supabase
        .from("shift_assignments")
        .select(
          "id,user_id,shift_id,status,users:users (full_name),shifts:shifts!inner (location_id,start_utc,end_utc,locations:locations (name,timezone))",
        )
        .neq("status", "dropped")
        .lte("shifts.start_utc", now)
        .gte("shifts.end_utc", now)
        .in("shifts.location_id", managedLocationIds)

      if (error) {
        setStatus(`Unable to load on-duty assignments: ${error.message}`)
        return
      }

      const normalized = (assignmentRows ?? []).map((row: any) => {
        const shift = Array.isArray(row.shifts) ? row.shifts[0] : row.shifts
        const user = Array.isArray(row.users) ? row.users[0] : row.users
        return {
          id: row.id,
          user_id: row.user_id,
          user_name: user?.full_name ?? "Unknown staff member",
          shift_id: row.shift_id,
          status: row.status,
          shifts: shift
            ? {
                location_id: shift.location_id,
                start_utc: shift.start_utc,
                end_utc: shift.end_utc,
                locations: shift.locations,
              }
            : null,
        } as Assignment
      })

      setAssignments(normalized)
      setStatus("")
    }

    void load()

    const channel = supabase
      .channel("manager-on-duty-assignments")
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_assignments" }, () => {
        void load()
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => {
        void load()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [managedLocationIds])

  const locationMap = useMemo(() => {
    return new Map(locations.map((location) => [location.id, location.name]))
  }, [locations])

  const timezoneMap = useMemo(() => {
    return new Map(locations.map((location) => [location.id, location.timezone]))
  }, [locations])

  const groupedAssignments = useMemo(() => {
    const groups = new Map<string, Assignment[]>()
    assignments.forEach((assignment) => {
      const locationId = assignment.shifts?.location_id ?? "unknown"
      if (!groups.has(locationId)) {
        groups.set(locationId, [])
      }
      groups.get(locationId)?.push(assignment)
    })
    return Array.from(groups.entries()).map(([locationId, rows]) => ({
      locationId,
      locationName: locationMap.get(locationId) ?? locationId,
      rows,
    }))
  }, [assignments, locationMap])

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">On-Duty Dashboard</h1>
        <p className="text-sm text-muted-foreground">Live view of on-duty staff across your locations.</p>
      </div>

      <section className="rounded-lg border border-border bg-background p-5">
        {status ? (
          <p className="text-sm text-muted-foreground">{status}</p>
        ) : groupedAssignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No staff are currently on duty.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {groupedAssignments.map((group) => (
              <div key={group.locationId} className="rounded-md border border-border bg-muted/10 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{group.locationName}</div>
                  <span className="text-xs text-muted-foreground">{group.rows.length} on duty</span>
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  {group.rows.map((row) => {
                    const timezone = timezoneMap.get(group.locationId) ?? "UTC"
                    const range = row.shifts
                      ? `${formatInTimeZone(new Date(row.shifts.start_utc), timezone, "MMM d, h:mm a")} → ${formatInTimeZone(
                          new Date(row.shifts.end_utc),
                          timezone,
                          "h:mm a",
                        )}`
                      : "Unknown shift"
                    return (
                      <div key={row.id} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                        <div>
                          <div className="font-medium">{row.user_name}</div>
                          <div className="text-xs text-muted-foreground">{range}</div>
                        </div>
                        <div className="text-xs uppercase text-muted-foreground">{timezone}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
