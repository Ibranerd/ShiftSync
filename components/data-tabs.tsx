"use client"

import { useEffect, useRef, useState } from "react"
import { ClipboardList, CalendarClock, MapPin, Users } from "lucide-react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import ConfirmDialog from "@/components/confirm-dialog"

type LocationRow = {
  id: string
  name: string
  timezone: string
}

type UserRow = {
  id: string
  full_name: string
  role: string
  desired_weekly_hours?: number | null
}

type ShiftRow = {
  id: string
  location_id: string
  start_utc: string
  end_utc: string
}

type AssignmentRow = {
  id: string
  user_id: string
  shift_id: string
  status: string
}

type SkillRow = {
  id: string
  name: string
}

type UserSkillRow = {
  user_id: string
  skill_id: string
}

type DataTabsProps = {
  scope: "admin" | "manager"
  title: string
  description: string
  limit?: number
}

export default function DataTabs({ scope, title, description, limit = 20 }: DataTabsProps) {
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [userSkills, setUserSkills] = useState<UserSkillRow[]>([])
  const [status, setStatus] = useState("Loading data...")
  const [activeTab, setActiveTab] = useState<"locations" | "users" | "shifts" | "assignments">("locations")
  const [locationMessage, setLocationMessage] = useState("")
  const [userMessage, setUserMessage] = useState("")
  const [shiftMessage, setShiftMessage] = useState("")
  const [assignmentMessage, setAssignmentMessage] = useState("")

  const [newLocationName, setNewLocationName] = useState("")
  const [newLocationTimezone, setNewLocationTimezone] = useState("UTC")
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
  const [editLocationName, setEditLocationName] = useState("")
  const [editLocationTimezone, setEditLocationTimezone] = useState("")

  const [newUserId, setNewUserId] = useState("")
  const [newUserName, setNewUserName] = useState("")
  const [newUserRole, setNewUserRole] = useState("staff")
  const [newUserHours, setNewUserHours] = useState("40")
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [editUserName, setEditUserName] = useState("")
  const [editUserRole, setEditUserRole] = useState("staff")
  const [editUserHours, setEditUserHours] = useState("40")

  const [newShiftLocationId, setNewShiftLocationId] = useState("")
  const [newShiftStart, setNewShiftStart] = useState("")
  const [newShiftEnd, setNewShiftEnd] = useState("")
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null)
  const [editShiftStart, setEditShiftStart] = useState("")
  const [editShiftEnd, setEditShiftEnd] = useState("")

  const [newAssignmentUserId, setNewAssignmentUserId] = useState("")
  const [newAssignmentShiftId, setNewAssignmentShiftId] = useState("")
  const [newAssignmentStatus, setNewAssignmentStatus] = useState("assigned")
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null)
  const [editAssignmentStatus, setEditAssignmentStatus] = useState("assigned")

  const canManageLocations = scope === "admin"
  const canManageUsers = scope === "admin"
  const canManageShifts = true
  const canManageAssignments = true

  const pendingConfirmAction = useRef<null | (() => void)>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTitle, setConfirmTitle] = useState("")
  const [confirmDescription, setConfirmDescription] = useState("")
  const [confirmLabel, setConfirmLabel] = useState("Delete")

  const requestConfirm = (payload: { title: string; description?: string; confirmLabel?: string; onConfirm: () => void }) => {
    pendingConfirmAction.current = payload.onConfirm
    setConfirmTitle(payload.title)
    setConfirmDescription(payload.description ?? "")
    setConfirmLabel(payload.confirmLabel ?? "Delete")
    setConfirmOpen(true)
  }

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()

    const loadForAdmin = async () => {
      const [locRes, userRes, shiftRes, assignRes, skillRes, userSkillRes] = await Promise.all([
        supabase.from("locations").select("id,name,timezone"),
        supabase.from("users").select("id,full_name,role,desired_weekly_hours"),
        supabase.from("shifts").select("id,location_id,start_utc,end_utc").order("start_utc", { ascending: false }).limit(limit),
        supabase
          .from("shift_assignments")
          .select("id,user_id,shift_id,status")
          .order("created_at", { ascending: false })
          .limit(limit),
        supabase.from("skills").select("id,name"),
        supabase.from("user_skills").select("user_id,skill_id"),
      ])

      if (locRes.error || userRes.error || shiftRes.error || assignRes.error || skillRes.error || userSkillRes.error) {
        setStatus("Unable to load data.")
        return
      }

      setLocations((locRes.data ?? []) as LocationRow[])
      setUsers((userRes.data ?? []) as UserRow[])
      setShifts((shiftRes.data ?? []) as ShiftRow[])
      setAssignments((assignRes.data ?? []) as AssignmentRow[])
      setSkills((skillRes.data ?? []) as SkillRow[])
      setUserSkills((userSkillRes.data ?? []) as UserSkillRow[])
      setStatus("")
    }

    const loadForManager = async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        setStatus("Please sign in to view data.")
        return
      }

      const { data: managerLocations, error: managerError } = await supabase
        .from("location_managers")
        .select("location_id")
        .eq("user_id", userData.user.id)

      if (managerError) {
        setStatus("Unable to load manager locations.")
        return
      }

      const locationIds = (managerLocations ?? []).map((row) => row.location_id)
      if (locationIds.length === 0) {
        setStatus("No assigned locations.")
        setLocations([])
        setUsers([])
        setShifts([])
        setAssignments([])
        return
      }

      const [locRes, shiftRes, userLocRes] = await Promise.all([
        supabase.from("locations").select("id,name,timezone").in("id", locationIds),
        supabase
          .from("shifts")
          .select("id,location_id,start_utc,end_utc")
          .in("location_id", locationIds)
          .order("start_utc", {
            ascending: false,
          })
          .limit(limit),
        supabase.from("user_locations").select("user_id").in("location_id", locationIds).is("revoked_at", null),
      ])

      if (locRes.error || shiftRes.error || userLocRes.error) {
        setStatus("Unable to load manager data.")
        return
      }

      const userIds = Array.from(new Set((userLocRes.data ?? []).map((row: any) => row.user_id)))
      const userRes =
        userIds.length > 0
          ? await supabase.from("users").select("id,full_name,role,desired_weekly_hours").in("id", userIds)
          : { data: [] as UserRow[] }

      if ("error" in userRes && userRes.error) {
        setStatus("Unable to load manager users.")
        return
      }

      const [skillRes, userSkillRes] = await Promise.all([
        supabase.from("skills").select("id,name"),
        userIds.length > 0
          ? supabase.from("user_skills").select("user_id,skill_id").in("user_id", userIds)
          : { data: [] as UserSkillRow[] },
      ])

      if ("error" in skillRes && skillRes.error) {
        setStatus("Unable to load manager skills.")
        return
      }
      if ("error" in userSkillRes && userSkillRes.error) {
        setStatus("Unable to load manager staff skills.")
        return
      }

      const shiftIds = (shiftRes.data ?? []).map((row: any) => row.id)
      const assignRes =
        shiftIds.length > 0
          ? await supabase
              .from("shift_assignments")
              .select("id,user_id,shift_id,status")
              .in("shift_id", shiftIds)
              .order("created_at", { ascending: false })
              .limit(limit)
          : { data: [] as AssignmentRow[] }

      if ("error" in assignRes && assignRes.error) {
        setStatus("Unable to load manager assignments.")
        return
      }

      setLocations((locRes.data ?? []) as LocationRow[])
      setUsers((userRes.data ?? []) as UserRow[])
      setShifts((shiftRes.data ?? []) as ShiftRow[])
      setAssignments((assignRes.data ?? []) as AssignmentRow[])
      setSkills((skillRes.data ?? []) as SkillRow[])
      setUserSkills((userSkillRes.data ?? []) as UserSkillRow[])
      setStatus("")
    }

    if (scope === "admin") {
      void loadForAdmin()
    } else {
      void loadForManager()
    }
  }, [limit, scope])

  const skillsMap = new Map(skills.map((skill) => [skill.id, skill.name]))

  const skillsByUser = userSkills.reduce((map, entry) => {
    const current = map.get(entry.user_id) ?? []
    const skillName = skillsMap.get(entry.skill_id)
    if (skillName) {
      current.push(skillName)
      map.set(entry.user_id, current)
    }
    return map
  }, new Map<string, string[]>())

  const locationNameById = new Map(locations.map((location) => [location.id, location.name]))
  const userNameById = new Map(users.map((user) => [user.id, user.full_name]))
  const shiftById = new Map(shifts.map((shift) => [shift.id, shift]))

  const formatShiftName = (shift: ShiftRow) => {
    const start = shift.start_utc ? new Date(shift.start_utc).toLocaleString() : "Unknown start"
    const end = shift.end_utc ? new Date(shift.end_utc).toLocaleString() : "Unknown end"
    return `Shift ${start} → ${end}`
  }

  useEffect(() => {
    if (!newShiftLocationId && locations.length > 0) {
      setNewShiftLocationId(locations[0].id)
    }
  }, [locations, newShiftLocationId])

  useEffect(() => {
    if (!newAssignmentUserId && users.length > 0) {
      setNewAssignmentUserId(users[0].id)
    }
  }, [newAssignmentUserId, users])

  useEffect(() => {
    if (!newAssignmentShiftId && shifts.length > 0) {
      setNewAssignmentShiftId(shifts[0].id)
    }
  }, [newAssignmentShiftId, shifts])

  const handleCreateLocation = async () => {
    if (!canManageLocations) return
    const name = newLocationName.trim()
    const timezone = newLocationTimezone.trim()
    if (!name || !timezone) {
      setLocationMessage("Enter a name and timezone.")
      return
    }
    setLocationMessage("")
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase.from("locations").insert({ name, timezone }).select("id,name,timezone").single()
    if (error || !data) {
      setLocationMessage("Unable to create location.")
      return
    }
    setLocations((current) => [...current, data as LocationRow])
    setNewLocationName("")
    setNewLocationTimezone("UTC")
    setLocationMessage("Location created.")
  }

  const startEditLocation = (location: LocationRow) => {
    setEditingLocationId(location.id)
    setEditLocationName(location.name)
    setEditLocationTimezone(location.timezone)
  }

  const handleUpdateLocation = async () => {
    if (!canManageLocations || !editingLocationId) return
    const name = editLocationName.trim()
    const timezone = editLocationTimezone.trim()
    if (!name || !timezone) {
      setLocationMessage("Enter a name and timezone.")
      return
    }
    setLocationMessage("")
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase
      .from("locations")
      .update({ name, timezone })
      .eq("id", editingLocationId)
      .select("id,name,timezone")
      .single()
    if (error || !data) {
      setLocationMessage("Unable to update location.")
      return
    }
    setLocations((current) => current.map((row) => (row.id === data.id ? (data as LocationRow) : row)))
    setEditingLocationId(null)
    setEditLocationName("")
    setEditLocationTimezone("")
    setLocationMessage("Location updated.")
  }

  const handleDeleteLocation = async (id: string) => {
    if (!canManageLocations) return
    setLocationMessage("")
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("locations").delete().eq("id", id)
    if (error) {
      setLocationMessage("Unable to delete location.")
      return
    }
    setLocations((current) => current.filter((row) => row.id !== id))
    setLocationMessage("Location deleted.")
  }

  const handleCreateUser = async () => {
    if (!canManageUsers) return
    const id = newUserId.trim()
    const name = newUserName.trim()
    if (!id || !name) {
      setUserMessage("Enter a user id and name.")
      return
    }
    setUserMessage("")
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase
      .from("users")
      .insert({
        id,
        full_name: name,
        role: newUserRole,
        desired_weekly_hours: Number(newUserHours) || 0,
      })
      .select("id,full_name,role,desired_weekly_hours")
      .single()
    if (error || !data) {
      setUserMessage("Unable to create user record.")
      return
    }
    setUsers((current) => [...current, data as UserRow])
    setNewUserId("")
    setNewUserName("")
    setNewUserRole("staff")
    setNewUserHours("40")
    setUserMessage("User record created.")
  }

  const startEditUser = (user: UserRow) => {
    setEditingUserId(user.id)
    setEditUserName(user.full_name)
    setEditUserRole(user.role)
    setEditUserHours(String(user.desired_weekly_hours ?? 0))
  }

  const handleUpdateUser = async () => {
    if (!canManageUsers || !editingUserId) return
    const name = editUserName.trim()
    if (!name) {
      setUserMessage("Enter a name.")
      return
    }
    setUserMessage("")
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase
      .from("users")
      .update({
        full_name: name,
        role: editUserRole,
        desired_weekly_hours: Number(editUserHours) || 0,
      })
      .eq("id", editingUserId)
      .select("id,full_name,role,desired_weekly_hours")
      .single()
    if (error || !data) {
      setUserMessage("Unable to update user.")
      return
    }
    setUsers((current) => current.map((row) => (row.id === data.id ? (data as UserRow) : row)))
    setEditingUserId(null)
    setEditUserName("")
    setEditUserRole("staff")
    setEditUserHours("40")
    setUserMessage("User updated.")
  }

  const handleDeleteUser = async (id: string) => {
    if (!canManageUsers) return
    setUserMessage("")
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("users").delete().eq("id", id)
    if (error) {
      setUserMessage("Unable to delete user record.")
      return
    }
    setUsers((current) => current.filter((row) => row.id !== id))
    setUserMessage("User record deleted.")
  }

  const handleCreateShift = async () => {
    if (!canManageShifts) return
    if (!newShiftLocationId || !newShiftStart || !newShiftEnd) {
      setShiftMessage("Select a location and start/end time.")
      return
    }
    setShiftMessage("")
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase
      .from("shifts")
      .insert({
        location_id: newShiftLocationId,
        start_utc: new Date(newShiftStart).toISOString(),
        end_utc: new Date(newShiftEnd).toISOString(),
        required_skill_ids: [],
        headcount_needed: 1,
        is_published: false,
      })
      .select("id,location_id,start_utc,end_utc")
      .single()
    if (error || !data) {
      setShiftMessage("Unable to create shift.")
      return
    }
    setShifts((current) => [data as ShiftRow, ...current])
    setNewShiftStart("")
    setNewShiftEnd("")
    setShiftMessage("Shift created.")
  }

  const startEditShift = (shift: ShiftRow) => {
    setEditingShiftId(shift.id)
    setEditShiftStart(shift.start_utc)
    setEditShiftEnd(shift.end_utc)
  }

  const handleUpdateShift = async () => {
    if (!canManageShifts || !editingShiftId) return
    if (!editShiftStart || !editShiftEnd) {
      setShiftMessage("Enter start and end times.")
      return
    }
    setShiftMessage("")
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase
      .from("shifts")
      .update({
        start_utc: new Date(editShiftStart).toISOString(),
        end_utc: new Date(editShiftEnd).toISOString(),
      })
      .eq("id", editingShiftId)
      .select("id,location_id,start_utc,end_utc")
      .single()
    if (error || !data) {
      setShiftMessage("Unable to update shift.")
      return
    }
    setShifts((current) => current.map((row) => (row.id === data.id ? (data as ShiftRow) : row)))
    setEditingShiftId(null)
    setEditShiftStart("")
    setEditShiftEnd("")
    setShiftMessage("Shift updated.")
  }

  const handleDeleteShift = async (id: string) => {
    if (!canManageShifts) return
    setShiftMessage("")
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("shifts").delete().eq("id", id)
    if (error) {
      setShiftMessage("Unable to delete shift.")
      return
    }
    setShifts((current) => current.filter((row) => row.id !== id))
    setShiftMessage("Shift deleted.")
  }

  const handleCreateAssignment = async () => {
    if (!canManageAssignments) return
    if (!newAssignmentUserId || !newAssignmentShiftId) {
      setAssignmentMessage("Select a user and shift.")
      return
    }
    setAssignmentMessage("")
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase
      .from("shift_assignments")
      .insert({
        user_id: newAssignmentUserId,
        shift_id: newAssignmentShiftId,
        status: newAssignmentStatus,
      })
      .select("id,user_id,shift_id,status")
      .single()
    if (error || !data) {
      setAssignmentMessage("Unable to create assignment.")
      return
    }
    setAssignments((current) => [data as AssignmentRow, ...current])
    setAssignmentMessage("Assignment created.")
  }

  const startEditAssignment = (assignment: AssignmentRow) => {
    setEditingAssignmentId(assignment.id)
    setEditAssignmentStatus(assignment.status)
  }

  const handleUpdateAssignment = async () => {
    if (!canManageAssignments || !editingAssignmentId) return
    setAssignmentMessage("")
    const supabase = createSupabaseBrowserClient()
    const { data, error } = await supabase
      .from("shift_assignments")
      .update({ status: editAssignmentStatus })
      .eq("id", editingAssignmentId)
      .select("id,user_id,shift_id,status")
      .single()
    if (error || !data) {
      setAssignmentMessage("Unable to update assignment.")
      return
    }
    setAssignments((current) => current.map((row) => (row.id === data.id ? (data as AssignmentRow) : row)))
    setEditingAssignmentId(null)
    setEditAssignmentStatus("assigned")
    setAssignmentMessage("Assignment updated.")
  }

  const handleDeleteAssignment = async (id: string) => {
    if (!canManageAssignments) return
    setAssignmentMessage("")
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.from("shift_assignments").delete().eq("id", id)
    if (error) {
      setAssignmentMessage("Unable to delete assignment.")
      return
    }
    setAssignments((current) => current.filter((row) => row.id !== id))
    setAssignmentMessage("Assignment deleted.")
  }

  return (
    <section className="rounded-lg border border-border bg-background p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
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

      {status ? (
        <p className="mt-4 text-sm text-muted-foreground">{status}</p>
      ) : (
        <div className="mt-4 rounded-lg border border-border bg-muted/10">
          {activeTab === "locations" && (
            <div>
              <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                Locations
              </div>
              <div className="border-b border-border px-4 py-3 text-sm">
                {canManageLocations ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">Name</label>
                      <input
                        type="text"
                        value={newLocationName}
                        onChange={(event) => setNewLocationName(event.target.value)}
                        className="w-48 rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder="Location name"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">Timezone</label>
                      <input
                        type="text"
                        value={newLocationTimezone}
                        onChange={(event) => setNewLocationTimezone(event.target.value)}
                        className="w-48 rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder="America/New_York"
                      />
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                      onClick={handleCreateLocation}
                    >
                      Add location
                    </button>
                    {locationMessage && <span className="text-sm text-muted-foreground">{locationMessage}</span>}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Location management is admin-only.</span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-left">Timezone</th>
                      {canManageLocations && <th className="px-4 py-3 text-left">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((location) => (
                      <tr key={location.id} className="border-t border-border">
                        <td className="px-4 py-3">
                          {editingLocationId === location.id ? (
                            <input
                              type="text"
                              value={editLocationName}
                              onChange={(event) => setEditLocationName(event.target.value)}
                              className="w-40 rounded-md border border-border bg-background px-2 py-1 text-sm"
                            />
                          ) : (
                            location.name
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editingLocationId === location.id ? (
                            <input
                              type="text"
                              value={editLocationTimezone}
                              onChange={(event) => setEditLocationTimezone(event.target.value)}
                              className="w-40 rounded-md border border-border bg-background px-2 py-1 text-sm"
                            />
                          ) : (
                            location.timezone
                          )}
                        </td>
                        {canManageLocations && (
                          <td className="px-4 py-3">
                            {editingLocationId === location.id ? (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                                  onClick={handleUpdateLocation}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    setEditingLocationId(null)
                                    setEditLocationName("")
                                    setEditLocationTimezone("")
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                                  onClick={() => startEditLocation(location)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    requestConfirm({
                                      title: "Delete location?",
                                      description: "This will remove the location and related records.",
                                      confirmLabel: "Delete location",
                                      onConfirm: () => handleDeleteLocation(location.id),
                                    })
                                  }
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                    {locations.length === 0 && (
                      <tr>
                        <td className="px-4 py-3 text-sm text-muted-foreground" colSpan={canManageLocations ? 3 : 2}>
                          No locations found.
                        </td>
                      </tr>
                    )}
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
              <div className="border-b border-border px-4 py-3 text-sm">
                {canManageUsers ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">User ID</label>
                      <input
                        type="text"
                        value={newUserId}
                        onChange={(event) => setNewUserId(event.target.value)}
                        className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder="UUID from auth.users"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">Name</label>
                      <input
                        type="text"
                        value={newUserName}
                        onChange={(event) => setNewUserName(event.target.value)}
                        className="w-48 rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder="Full name"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">Role</label>
                      <select
                        value={newUserRole}
                        onChange={(event) => setNewUserRole(event.target.value)}
                        className="w-36 rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        <option value="admin">admin</option>
                        <option value="manager">manager</option>
                        <option value="staff">staff</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">Desired hrs</label>
                      <input
                        type="number"
                        value={newUserHours}
                        onChange={(event) => setNewUserHours(event.target.value)}
                        className="w-28 rounded-md border border-border bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                      onClick={handleCreateUser}
                    >
                      Add user
                    </button>
                    {userMessage && <span className="text-sm text-muted-foreground">{userMessage}</span>}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">User management is admin-only.</span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-left">Role</th>
                      <th className="px-4 py-3 text-left">Desired hrs</th>
                      <th className="px-4 py-3 text-left">Skills</th>
                      {canManageUsers && <th className="px-4 py-3 text-left">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id} className="border-t border-border">
                        <td className="px-4 py-3">
                          {editingUserId === user.id ? (
                            <input
                              type="text"
                              value={editUserName}
                              onChange={(event) => setEditUserName(event.target.value)}
                              className="w-40 rounded-md border border-border bg-background px-2 py-1 text-sm"
                            />
                          ) : (
                            user.full_name
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editingUserId === user.id ? (
                            <select
                              value={editUserRole}
                              onChange={(event) => setEditUserRole(event.target.value)}
                              className="w-32 rounded-md border border-border bg-background px-2 py-1 text-sm"
                            >
                              <option value="admin">admin</option>
                              <option value="manager">manager</option>
                              <option value="staff">staff</option>
                            </select>
                          ) : (
                            user.role
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editingUserId === user.id ? (
                            <input
                              type="number"
                              value={editUserHours}
                              onChange={(event) => setEditUserHours(event.target.value)}
                              className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
                            />
                          ) : (
                            `${user.desired_weekly_hours ?? 0} hrs`
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {(skillsByUser.get(user.id) ?? []).join(", ") || "—"}
                        </td>
                        {canManageUsers && (
                          <td className="px-4 py-3">
                            {editingUserId === user.id ? (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                                  onClick={handleUpdateUser}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    setEditingUserId(null)
                                    setEditUserName("")
                                    setEditUserRole("staff")
                                    setEditUserHours("40")
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                                  onClick={() => startEditUser(user)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    requestConfirm({
                                      title: "Delete user record?",
                                      description: "This removes the user row and all related assignments.",
                                      confirmLabel: "Delete user",
                                      onConfirm: () => handleDeleteUser(user.id),
                                    })
                                  }
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr>
                        <td className="px-4 py-3 text-sm text-muted-foreground" colSpan={canManageUsers ? 5 : 4}>
                          No users found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "shifts" && (
            <div>
              <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                Shifts (latest {limit})
              </div>
              <div className="border-b border-border px-4 py-3 text-sm">
                {canManageShifts ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">Location</label>
                      <select
                        value={newShiftLocationId}
                        onChange={(event) => setNewShiftLocationId(event.target.value)}
                        className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        {locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">Start (UTC)</label>
                      <input
                        type="text"
                        value={newShiftStart}
                        onChange={(event) => setNewShiftStart(event.target.value)}
                        className="w-60 rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder="2025-01-01T09:00:00Z"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">End (UTC)</label>
                      <input
                        type="text"
                        value={newShiftEnd}
                        onChange={(event) => setNewShiftEnd(event.target.value)}
                        className="w-60 rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder="2025-01-01T17:00:00Z"
                      />
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                      onClick={handleCreateShift}
                    >
                      Add shift
                    </button>
                    {shiftMessage && <span className="text-sm text-muted-foreground">{shiftMessage}</span>}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Shift management is restricted.</span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Shift</th>
                      <th className="px-4 py-3 text-left">Location</th>
                      <th className="px-4 py-3 text-left">Start</th>
                      <th className="px-4 py-3 text-left">End</th>
                      {canManageShifts && <th className="px-4 py-3 text-left">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map((shift) => (
                      <tr key={shift.id} className="border-t border-border">
                        <td className="px-4 py-3">{formatShiftName(shift)}</td>
                        <td className="px-4 py-3">{locationNameById.get(shift.location_id) ?? shift.location_id}</td>
                        <td className="px-4 py-3">
                          {editingShiftId === shift.id ? (
                            <input
                              type="text"
                              value={editShiftStart}
                              onChange={(event) => setEditShiftStart(event.target.value)}
                              className="w-56 rounded-md border border-border bg-background px-2 py-1 text-sm"
                            />
                          ) : (
                            shift.start_utc
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editingShiftId === shift.id ? (
                            <input
                              type="text"
                              value={editShiftEnd}
                              onChange={(event) => setEditShiftEnd(event.target.value)}
                              className="w-56 rounded-md border border-border bg-background px-2 py-1 text-sm"
                            />
                          ) : (
                            shift.end_utc
                          )}
                        </td>
                        {canManageShifts && (
                          <td className="px-4 py-3">
                            {editingShiftId === shift.id ? (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                                  onClick={handleUpdateShift}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    setEditingShiftId(null)
                                    setEditShiftStart("")
                                    setEditShiftEnd("")
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                                  onClick={() => startEditShift(shift)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    requestConfirm({
                                      title: "Delete shift?",
                                      description: "This removes the shift and any linked assignments.",
                                      confirmLabel: "Delete shift",
                                      onConfirm: () => handleDeleteShift(shift.id),
                                    })
                                  }
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                    {shifts.length === 0 && (
                      <tr>
                        <td className="px-4 py-3 text-sm text-muted-foreground" colSpan={canManageShifts ? 5 : 4}>
                          No shifts found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "assignments" && (
            <div>
              <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                Assignments (latest {limit})
              </div>
              <div className="border-b border-border px-4 py-3 text-sm">
                {canManageAssignments ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">User</label>
                      <select
                        value={newAssignmentUserId}
                        onChange={(event) => setNewAssignmentUserId(event.target.value)}
                        className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.full_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">Shift</label>
                      <select
                        value={newAssignmentShiftId}
                        onChange={(event) => setNewAssignmentShiftId(event.target.value)}
                        className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        {shifts.map((shift) => (
                          <option key={shift.id} value={shift.id}>
                            {formatShiftName(shift)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs uppercase tracking-wide text-muted-foreground">Status</label>
                      <select
                        value={newAssignmentStatus}
                        onChange={(event) => setNewAssignmentStatus(event.target.value)}
                        className="w-36 rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        <option value="assigned">assigned</option>
                        <option value="confirmed">confirmed</option>
                        <option value="dropped">dropped</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                      onClick={handleCreateAssignment}
                    >
                      Add assignment
                    </button>
                    {assignmentMessage && <span className="text-sm text-muted-foreground">{assignmentMessage}</span>}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Assignment management is restricted.</span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Assignment ID</th>
                      <th className="px-4 py-3 text-left">User</th>
                      <th className="px-4 py-3 text-left">Shift</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      {canManageAssignments && <th className="px-4 py-3 text-left">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((row) => (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{row.id}</td>
                        <td className="px-4 py-3">{userNameById.get(row.user_id) ?? row.user_id}</td>
                        <td className="px-4 py-3">
                          {shiftById.get(row.shift_id) ? formatShiftName(shiftById.get(row.shift_id)!) : row.shift_id}
                        </td>
                        <td className="px-4 py-3">
                          {editingAssignmentId === row.id ? (
                            <select
                              value={editAssignmentStatus}
                              onChange={(event) => setEditAssignmentStatus(event.target.value)}
                              className="w-32 rounded-md border border-border bg-background px-2 py-1 text-sm"
                            >
                              <option value="assigned">assigned</option>
                              <option value="confirmed">confirmed</option>
                              <option value="dropped">dropped</option>
                            </select>
                          ) : (
                            row.status
                          )}
                        </td>
                        {canManageAssignments && (
                          <td className="px-4 py-3">
                            {editingAssignmentId === row.id ? (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                                  onClick={handleUpdateAssignment}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    setEditingAssignmentId(null)
                                    setEditAssignmentStatus("assigned")
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                                  onClick={() => startEditAssignment(row)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    requestConfirm({
                                      title: "Delete assignment?",
                                      description: "This removes the assignment record.",
                                      confirmLabel: "Delete assignment",
                                      onConfirm: () => handleDeleteAssignment(row.id),
                                    })
                                  }
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                    {assignments.length === 0 && (
                      <tr>
                        <td className="px-4 py-3 text-sm text-muted-foreground" colSpan={canManageAssignments ? 5 : 4}>
                          No assignments found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmLabel}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => pendingConfirmAction.current?.()}
      />
    </section>
  )
}
