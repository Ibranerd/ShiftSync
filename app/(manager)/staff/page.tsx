"use client"

import { useEffect, useMemo, useState } from "react"
import { formatInTimeZone } from "date-fns-tz"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import DataTabs from "@/components/data-tabs"

type StaffRow = {
  id: string
  full_name: string
  role: string
  desired_weekly_hours: number | null
}

type LocationRow = {
  id: string
  name: string
  timezone: string
}

type WeeklyHoursRow = {
  user_id: string
  week_start: string
  total_hours: number
}

type SkillRow = {
  id: string
  name: string
}

type UserSkillRow = {
  user_id: string
  skill_id: string
}

type CertificationRow = {
  user_id: string
  location_id: string
  certified_at: string
  revoked_at: string | null
}

export default function ManagerStaffPage() {
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [weeklyHours, setWeeklyHours] = useState<WeeklyHoursRow[]>([])
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [userSkills, setUserSkills] = useState<UserSkillRow[]>([])
  const [certifications, setCertifications] = useState<CertificationRow[]>([])
  const [status, setStatus] = useState("Loading staff overview...")
  const [certMessage, setCertMessage] = useState("")
  const [selectedStaffId, setSelectedStaffId] = useState("")
  const [selectedLocationId, setSelectedLocationId] = useState("")

  const weekStart = useMemo(() => {
    const now = new Date()
    const day = now.getUTCDay() || 7
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)))
    return monday.toISOString()
  }, [])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const load = async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        setStatus("Please sign in to view staff.")
        return
      }

      const { data: locationManagers } = await supabase
        .from("location_managers")
        .select("location_id")
        .eq("user_id", userData.user.id)

      const locationIds = (locationManagers ?? []).map((row) => row.location_id)
      if (locationIds.length === 0) {
        setStatus("No assigned locations.")
        return
      }

      const [locationRes, userLocationRes, staffRes, weeklyRes, skillRes, userSkillRes] = await Promise.all([
        supabase.from("locations").select("id,name,timezone").in("id", locationIds),
        supabase
          .from("user_locations")
          .select("user_id,location_id,certified_at,revoked_at")
          .in("location_id", locationIds),
        supabase.from("users").select("id,full_name,role,desired_weekly_hours").eq("role", "staff"),
        supabase
          .from("weekly_hours")
          .select("user_id,week_start,total_hours")
          .gte("week_start", weekStart)
          .lt("week_start", new Date(new Date(weekStart).getTime() + 7 * 86400000).toISOString()),
        supabase.from("skills").select("id,name"),
        supabase.from("user_skills").select("user_id,skill_id"),
      ])

      if (
        locationRes.error ||
        userLocationRes.error ||
        staffRes.error ||
        weeklyRes.error ||
        skillRes.error ||
        userSkillRes.error
      ) {
        setStatus("Unable to load staff data.")
        return
      }

      const eligibleUserIds = new Set((userLocationRes.data ?? []).map((row: any) => row.user_id))
      const filteredStaff = (staffRes.data ?? []).filter((row: any) => eligibleUserIds.has(row.id))

      setLocations((locationRes.data ?? []) as LocationRow[])
      setStaff(filteredStaff as StaffRow[])
      setWeeklyHours((weeklyRes.data ?? []) as WeeklyHoursRow[])
      setSkills((skillRes.data ?? []) as SkillRow[])
      setUserSkills((userSkillRes.data ?? []) as UserSkillRow[])
      setCertifications((userLocationRes.data ?? []) as CertificationRow[])
      setStatus("")

    }

    void load()
  }, [weekStart])

  useEffect(() => {
    if (!selectedStaffId && staff.length > 0) {
      setSelectedStaffId(staff[0].id)
      return
    }

    if (selectedStaffId && !staff.some((member) => member.id === selectedStaffId) && staff.length > 0) {
      setSelectedStaffId(staff[0].id)
    }
  }, [staff, selectedStaffId])

  const hoursByUser = useMemo(() => {
    const map = new Map<string, number>()
    weeklyHours.forEach((row) => {
      map.set(row.user_id, Number(row.total_hours))
    })
    return map
  }, [weeklyHours])

  const skillsMap = useMemo(() => {
    return new Map(skills.map((skill) => [skill.id, skill.name]))
  }, [skills])

  const skillsByUser = useMemo(() => {
    return userSkills.reduce((map, entry) => {
      const current = map.get(entry.user_id) ?? []
      const skillName = skillsMap.get(entry.skill_id)
      if (skillName) {
        current.push(skillName)
        map.set(entry.user_id, current)
      }
      return map
    }, new Map<string, string[]>())
  }, [skillsMap, userSkills])

  const locationNameById = useMemo(() => {
    return new Map(locations.map((location) => [location.id, location.name]))
  }, [locations])

  const activeCertifications = useMemo(() => {
    const now = new Date()
    return certifications.filter((row) => !row.revoked_at || new Date(row.revoked_at) > now)
  }, [certifications])

  const selectedStaffCerts = useMemo(() => {
    return certifications.filter((row) => row.user_id === selectedStaffId)
  }, [certifications, selectedStaffId])

  const selectedActiveCerts = useMemo(() => {
    const now = new Date()
    return selectedStaffCerts.filter((row) => !row.revoked_at || new Date(row.revoked_at) > now)
  }, [selectedStaffCerts])

  const availableLocations = useMemo(() => {
    const activeLocationIds = new Set(selectedActiveCerts.map((row) => row.location_id))
    return locations.filter((location) => !activeLocationIds.has(location.id))
  }, [locations, selectedActiveCerts])

  useEffect(() => {
    if (availableLocations.length === 0) {
      if (selectedLocationId) {
        setSelectedLocationId("")
      }
      return
    }

    if (!availableLocations.some((location) => location.id === selectedLocationId)) {
      setSelectedLocationId(availableLocations[0].id)
    }
  }, [availableLocations, selectedLocationId])

  const addCertification = async () => {
    setCertMessage("")
    if (!selectedStaffId || !selectedLocationId) {
      setCertMessage("Select a staff member and location.")
      return
    }
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase
      .from("user_locations")
      .insert({
        user_id: selectedStaffId,
        location_id: selectedLocationId,
        certified_at: new Date().toISOString(),
      })
      .select("user_id,location_id,certified_at,revoked_at")
      .single()

    if (error || !data) {
      setCertMessage("Unable to add certification.")
      return
    }

    setCertifications((current) => [...current, data as CertificationRow])
    setCertMessage("Certification added.")
  }

  const revokeCertification = async (entry: CertificationRow) => {
    setCertMessage("")
    const supabase = createSupabaseBrowserClient()
    const revokedAt = new Date().toISOString()
    const { data, error } = await supabase
      .from("user_locations")
      .update({ revoked_at: revokedAt })
      .eq("user_id", entry.user_id)
      .eq("location_id", entry.location_id)
      .eq("certified_at", entry.certified_at)
      .select("user_id,location_id,certified_at,revoked_at")
      .single()

    if (error || !data) {
      setCertMessage("Unable to remove certification.")
      return
    }

    setCertifications((current) =>
      current.map((row) =>
        row.user_id === data.user_id &&
        row.location_id === data.location_id &&
        row.certified_at === data.certified_at
          ? (data as CertificationRow)
          : row,
      ),
    )
    setCertMessage("Certification removed.")
  }

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Staff Coverage</h1>
        <p className="text-sm text-muted-foreground">
          Weekly workload vs desired hours for your assigned locations.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-background p-5">
        <div className="text-sm text-muted-foreground">
          Week of {formatInTimeZone(new Date(weekStart), "UTC", "MMM d, yyyy")}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Locations: {locations.map((location) => location.name).join(", ")}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-5">
        {status ? (
          <p className="text-sm text-muted-foreground">{status}</p>
        ) : staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">No staff found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Staff member</th>
                  <th className="px-4 py-3 text-left">Desired hours</th>
                  <th className="px-4 py-3 text-left">Assigned hours</th>
                  <th className="px-4 py-3 text-left">Delta</th>
                  <th className="px-4 py-3 text-left">Skills</th>
                  <th className="px-4 py-3 text-left">Active certifications</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((member) => {
                  const desired = member.desired_weekly_hours ?? 0
                  const assigned = hoursByUser.get(member.id) ?? 0
                  const delta = assigned - desired
                  const memberCerts = activeCertifications.filter((row) => row.user_id === member.id)
                  const memberSkills = skillsByUser.get(member.id) ?? []
                  return (
                    <tr key={member.id} className="border-t border-border">
                      <td className="px-4 py-3">{member.full_name}</td>
                      <td className="px-4 py-3">{desired.toFixed(1)} hrs</td>
                      <td className="px-4 py-3">{assigned.toFixed(1)} hrs</td>
                      <td className={`px-4 py-3 ${delta > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(1)} hrs
                      </td>
                      <td className="px-4 py-3">{memberSkills.join(", ") || "—"}</td>
                      <td className="px-4 py-3">
                        {memberCerts.length === 0
                          ? "—"
                          : memberCerts
                              .map((row) => locationNameById.get(row.location_id) ?? row.location_id)
                              .join(", ")}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">Certifications</h2>
        <p className="text-sm text-muted-foreground">
          Add or remove location certifications for staff in your managed locations.
        </p>

        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Staff member</label>
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={selectedStaffId}
              onChange={(event) => setSelectedStaffId(event.target.value)}
            >
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Location</label>
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={selectedLocationId}
              onChange={(event) => setSelectedLocationId(event.target.value)}
            >
              {availableLocations.length === 0 ? (
                <option value="">No available locations</option>
              ) : (
                availableLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name} ({location.timezone})
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              onClick={addCertification}
              disabled={availableLocations.length === 0}
            >
              Add certification
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3 text-sm">
          {certMessage && <span className="text-muted-foreground">{certMessage}</span>}
        </div>

        <div className="mt-5 grid gap-4 text-sm md:grid-cols-2">
          <div className="rounded-md border border-border bg-muted/10 p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Active</div>
            <div className="mt-2 space-y-2">
              {selectedActiveCerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active certifications.</p>
              ) : (
                selectedActiveCerts.map((entry) => (
                  <div key={`${entry.user_id}-${entry.location_id}-${entry.certified_at}`} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                    <div>
                      <div className="font-medium">
                        {locationNameById.get(entry.location_id) ?? entry.location_id}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Certified {formatInTimeZone(new Date(entry.certified_at), "UTC", "MMM d, yyyy")}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                      onClick={() => revokeCertification(entry)}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/10 p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">History</div>
            <div className="mt-2 space-y-2">
              {selectedStaffCerts.filter((row) => row.revoked_at).length === 0 ? (
                <p className="text-sm text-muted-foreground">No revoked certifications.</p>
              ) : (
                selectedStaffCerts
                  .filter((row) => row.revoked_at)
                  .map((entry) => (
                    <div
                      key={`${entry.user_id}-${entry.location_id}-${entry.certified_at}`}
                      className="rounded-md border border-border bg-background px-3 py-2"
                    >
                      <div className="font-medium">
                        {locationNameById.get(entry.location_id) ?? entry.location_id}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Certified {formatInTimeZone(new Date(entry.certified_at), "UTC", "MMM d, yyyy")} · Revoked{" "}
                        {entry.revoked_at
                          ? formatInTimeZone(new Date(entry.revoked_at), "UTC", "MMM d, yyyy")
                          : "—"}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      </section>

      <DataTabs
        scope="manager"
        title="Manager Data"
        description="Locations, staff, shifts, and assignments for your managed locations."
      />
    </main>
  )
}
