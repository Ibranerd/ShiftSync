"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { formatInTimeZone } from "date-fns-tz"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import DataTabs from "@/components/data-tabs"
import ConfirmDialog from "@/components/confirm-dialog"

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
    locations?: { name: string | null } | null
  } | null
}

export default function AdminDashboardPage() {
  const [status, setStatus] = useState("Loading on-duty assignments...")
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [locations, setLocations] = useState<Array<{ id: string; name: string; timezone: string }>>([])
  const [skills, setSkills] = useState<Array<{ id: string; name: string }>>([])
  const [userSkills, setUserSkills] = useState<Array<{ user_id: string; skill_id: string }>>([])
  const [staffUsers, setStaffUsers] = useState<Array<{ id: string; full_name: string }>>([])
  const [newSkillName, setNewSkillName] = useState("")
  const [skillMessage, setSkillMessage] = useState("")
  const [editSkillId, setEditSkillId] = useState<string | null>(null)
  const [editSkillName, setEditSkillName] = useState("")
  const [assignMessage, setAssignMessage] = useState("")
  const [selectedStaffId, setSelectedStaffId] = useState("")
  const [selectedSkillId, setSelectedSkillId] = useState("")
  const pendingConfirmAction = useRef<null | (() => void)>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTitle, setConfirmTitle] = useState("")
  const [confirmDescription, setConfirmDescription] = useState("")
  const [confirmLabel, setConfirmLabel] = useState("Delete")

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()

    const loadLocations = async () => {
      const { data: locationRows } = await supabase.from("locations").select("id,name,timezone")
      setLocations((locationRows ?? []) as any)
    }

    const load = async () => {
      const now = new Date().toISOString()
      let assignmentRows = null as any[] | null
      let assignmentError: Error | null = null

      const primary = await supabase
        .from("shift_assignments")
        .select(
          "id,user_id,shift_id,status,users:users (full_name),shifts:shifts!inner (location_id,start_utc,end_utc,locations:locations (name))",
        )
        .neq("status", "dropped")
        .lte("shifts.start_utc", now)
        .gte("shifts.end_utc", now)

      if (primary.error) {
        const fallback = await supabase
          .from("shift_assignments")
          .select("id,user_id,shift_id,status,shifts:shifts!inner (location_id,start_utc,end_utc,locations:locations (name))")
          .neq("status", "dropped")
          .lte("shifts.start_utc", now)
          .gte("shifts.end_utc", now)

        if (fallback.error) {
          assignmentError = fallback.error
        } else {
          assignmentRows = fallback.data ?? []
        }
      } else {
        assignmentRows = primary.data ?? []
      }

      if (assignmentError) {
        setStatus(`Unable to load on-duty assignments: ${assignmentError.message}`)
        return
      }

      const assignmentUserIds = Array.from(
        new Set((assignmentRows ?? []).map((row: any) => row.user_id).filter(Boolean)),
      )
      let assignmentUserMap = new Map<string, string>()
      if (assignmentUserIds.length > 0) {
        const { data: userRows } = await supabase.from("users").select("id,full_name").in("id", assignmentUserIds)
        assignmentUserMap = new Map((userRows ?? []).map((user) => [user.id, user.full_name]))
      }

      const normalized = (assignmentRows ?? []).map((row: any) => {
        const shift = Array.isArray(row.shifts) ? row.shifts[0] : row.shifts
        const user = Array.isArray(row.users) ? row.users[0] : row.users
        return {
          id: row.id,
          user_id: row.user_id,
          user_name: user?.full_name ?? assignmentUserMap.get(row.user_id) ?? "Unknown staff member",
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
    void loadLocations()

    const channel = supabase
      .channel("on-duty-assignments")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shift_assignments" },
        () => {
          void load()
          void loadLocations()
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shifts" },
        () => {
          void load()
          void loadLocations()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const loadSkills = async () => {
      const [skillRes, userSkillRes, staffRes] = await Promise.all([
        supabase.from("skills").select("id,name").order("name"),
        supabase.from("user_skills").select("user_id,skill_id"),
        supabase.from("users").select("id,full_name,role").eq("role", "staff").order("full_name"),
      ])

      if (skillRes.error || userSkillRes.error || staffRes.error) {
        setSkillMessage("Unable to load skills.")
        return
      }

      setSkills((skillRes.data ?? []) as any)
      setUserSkills((userSkillRes.data ?? []) as any)
      setStaffUsers(((staffRes.data ?? []) as any).map((row: any) => ({ id: row.id, full_name: row.full_name })))
    }

    void loadSkills()
  }, [])

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

  const skillsMap = useMemo(() => {
    return new Map(skills.map((skill) => [skill.id, skill.name]))
  }, [skills])

  const staffSkills = useMemo(() => {
    return userSkills.filter((entry) => entry.user_id === selectedStaffId)
  }, [userSkills, selectedStaffId])

  const availableSkills = useMemo(() => {
    const assigned = new Set(staffSkills.map((entry) => entry.skill_id))
    return skills.filter((skill) => !assigned.has(skill.id))
  }, [skills, staffSkills])

  useEffect(() => {
    if (!selectedStaffId && staffUsers.length > 0) {
      setSelectedStaffId(staffUsers[0].id)
      return
    }

    if (selectedStaffId && !staffUsers.some((user) => user.id === selectedStaffId) && staffUsers.length > 0) {
      setSelectedStaffId(staffUsers[0].id)
    }
  }, [selectedStaffId, staffUsers])

  useEffect(() => {
    if (availableSkills.length === 0) {
      if (selectedSkillId) {
        setSelectedSkillId("")
      }
      return
    }

    if (!availableSkills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId(availableSkills[0].id)
    }
  }, [availableSkills, selectedSkillId])

  const createSkill = async () => {
    const name = newSkillName.trim()
    if (!name) {
      setSkillMessage("Enter a skill name.")
      return
    }
    const supabase = createSupabaseBrowserClient()
    setSkillMessage("")
    const { data, error } = await supabase.from("skills").insert({ name }).select("id,name").single()
    if (error || !data) {
      setSkillMessage("Unable to add skill.")
      return
    }
    setSkills((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewSkillName("")
    setSkillMessage("Skill added.")
  }

  const startEditSkill = (id: string, name: string) => {
    setEditSkillId(id)
    setEditSkillName(name)
  }

  const saveSkill = async () => {
    if (!editSkillId) return
    const name = editSkillName.trim()
    if (!name) {
      setSkillMessage("Enter a skill name.")
      return
    }
    const supabase = createSupabaseBrowserClient()
    setSkillMessage("")
    const { data, error } = await supabase.from("skills").update({ name }).eq("id", editSkillId).select("id,name").single()
    if (error || !data) {
      setSkillMessage("Unable to update skill.")
      return
    }
    setSkills((current) =>
      current.map((skill) => (skill.id === data.id ? data : skill)).sort((a, b) => a.name.localeCompare(b.name)),
    )
    setEditSkillId(null)
    setEditSkillName("")
    setSkillMessage("Skill updated.")
  }

  const deleteSkill = async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    setSkillMessage("")
    const { error } = await supabase.from("skills").delete().eq("id", id)
    if (error) {
      setSkillMessage("Unable to delete skill.")
      return
    }
    setSkills((current) => current.filter((skill) => skill.id !== id))
    setUserSkills((current) => current.filter((entry) => entry.skill_id !== id))
    if (editSkillId === id) {
      setEditSkillId(null)
      setEditSkillName("")
    }
    setSkillMessage("Skill deleted.")
  }

  const requestConfirm = (payload: { title: string; description?: string; confirmLabel?: string; onConfirm: () => void }) => {
    pendingConfirmAction.current = payload.onConfirm
    setConfirmTitle(payload.title)
    setConfirmDescription(payload.description ?? "")
    setConfirmLabel(payload.confirmLabel ?? "Delete")
    setConfirmOpen(true)
  }

  const assignSkill = async () => {
    if (!selectedStaffId || !selectedSkillId) {
      setAssignMessage("Select a staff member and skill.")
      return
    }
    const supabase = createSupabaseBrowserClient()
    setAssignMessage("")
    const { data, error } = await supabase
      .from("user_skills")
      .insert({ user_id: selectedStaffId, skill_id: selectedSkillId })
      .select("user_id,skill_id")
      .single()
    if (error || !data) {
      setAssignMessage("Unable to assign skill.")
      return
    }
    setUserSkills((current) => [...current, data])
    setAssignMessage("Skill assigned.")
  }

  const removeSkill = async (userId: string, skillId: string) => {
    const supabase = createSupabaseBrowserClient()
    setAssignMessage("")
    const { error } = await supabase.from("user_skills").delete().eq("user_id", userId).eq("skill_id", skillId)
    if (error) {
      setAssignMessage("Unable to remove skill.")
      return
    }
    setUserSkills((current) => current.filter((entry) => !(entry.user_id === userId && entry.skill_id === skillId)))
    setAssignMessage("Skill removed.")
  }

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
          <div className="space-y-4 text-sm">
            {groupedAssignments.map((group) => (
              <div key={group.locationId} className="rounded-md border border-border bg-muted/10 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{group.locationName}</div>
                  <span className="text-xs text-muted-foreground">{group.rows.length} on duty</span>
                </div>
                <div className="mt-3 space-y-2">
                  {group.rows.map((assignment) => (
                    <div key={assignment.id} className="rounded-md border border-border bg-background p-3">
                      <div className="font-medium">{assignment.user_name}</div>
                      <div className="text-muted-foreground">
                        {assignment.shifts?.locations?.name ?? group.locationName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {assignment.shifts?.start_utc && assignment.shifts?.end_utc
                          ? `${formatInTimeZone(new Date(assignment.shifts.start_utc), timezoneMap.get(group.locationId) ?? "UTC", "MMM d, h:mm a")} → ${formatInTimeZone(new Date(assignment.shifts.end_utc), timezoneMap.get(group.locationId) ?? "UTC", "MMM d, h:mm a")}`
                          : "Unknown time"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <DataTabs
        scope="admin"
        title="Admin Data"
        description="Quick access to locations, users, shifts, and assignments."
      />

      <section className="rounded-lg border border-border bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Staff Skills</h2>
            <p className="text-sm text-muted-foreground">Create skills and assign them to staff.</p>
          </div>
          {skillMessage && <span className="text-sm text-muted-foreground">{skillMessage}</span>}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-border bg-muted/10 p-4">
            <h3 className="text-sm font-semibold">Skills Catalog</h3>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={newSkillName}
                onChange={(event) => setNewSkillName(event.target.value)}
                placeholder="New skill (e.g. bartender)"
                className="w-full flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm md:w-auto"
              />
              <button
                type="button"
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                onClick={createSkill}
              >
                Add skill
              </button>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              {skills.length === 0 ? (
                <p className="text-sm text-muted-foreground">No skills created yet.</p>
              ) : (
                skills.map((skill) => (
                  <div key={skill.id} className="rounded-md border border-border bg-background px-3 py-2">
                    {editSkillId === skill.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={editSkillName}
                          onChange={(event) => setEditSkillName(event.target.value)}
                          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
                        />
                        <button
                          type="button"
                          className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                          onClick={saveSkill}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setEditSkillId(null)
                            setEditSkillName("")
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">{skill.name}</div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                            onClick={() => startEditSkill(skill.id, skill.name)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              requestConfirm({
                                title: "Delete skill?",
                                description: "This will remove the skill and unassign it from all staff.",
                                confirmLabel: "Delete skill",
                                onConfirm: () => deleteSkill(skill.id),
                              })
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/10 p-4">
            <h3 className="text-sm font-semibold">Assign Skills to Staff</h3>
            <div className="mt-3 grid gap-3 text-sm">
              <div>
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Staff member</label>
                <select
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                  value={selectedStaffId}
                  onChange={(event) => setSelectedStaffId(event.target.value)}
                >
                  {staffUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Skill</label>
                <select
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
                  value={selectedSkillId}
                  onChange={(event) => setSelectedSkillId(event.target.value)}
                >
                  {availableSkills.length === 0 ? (
                    <option value="">No available skills</option>
                  ) : (
                    availableSkills.map((skill) => (
                      <option key={skill.id} value={skill.id}>
                        {skill.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                onClick={assignSkill}
                disabled={!selectedStaffId || availableSkills.length === 0}
              >
                Assign skill
              </button>
              {assignMessage && <span className="text-sm text-muted-foreground">{assignMessage}</span>}
            </div>

            <div className="mt-4 space-y-2 text-sm">
              {staffSkills.length === 0 ? (
                <p className="text-sm text-muted-foreground">No skills assigned yet.</p>
              ) : (
                staffSkills.map((entry) => (
                  <div key={`${entry.user_id}-${entry.skill_id}`} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                    <div className="font-medium">{skillsMap.get(entry.skill_id) ?? entry.skill_id}</div>
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        requestConfirm({
                          title: "Remove skill from staff?",
                          description: "This will unassign the skill from the staff member.",
                          confirmLabel: "Remove skill",
                          onConfirm: () => removeSkill(entry.user_id, entry.skill_id),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
      <ConfirmDialog
        open={confirmOpen}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmLabel}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => pendingConfirmAction.current?.()}
      />
    </main>
  )
}
