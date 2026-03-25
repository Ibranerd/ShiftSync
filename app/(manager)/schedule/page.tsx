"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import FullCalendar from "@fullcalendar/react"
import dayGridPlugin from "@fullcalendar/daygrid"
import timeGridPlugin from "@fullcalendar/timegrid"
import interactionPlugin, { DateSelectArg, EventDropArg } from "@fullcalendar/interaction"
import type { EventClickArg } from "@fullcalendar/core"
// FullCalendar v6 no longer ships CSS files in npm packages.
// Add custom styles in globals.css if needed.
import { formatInTimeZone } from "date-fns-tz"

import {
  validateAssignment,
  type AvailabilityWindow,
  type StaffCandidate,
  type Shift,
  type ShiftAssignment,
  type UserLocation,
  type Skill,
  type Violation,
} from "@/lib/constraint-engine"
import { calculateWeeklyHours } from "@/lib/overtime"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { formatAssignmentError } from "@/lib/ui/errors"

type ShiftRow = {
  id: string
  location_id: string
  start_utc: string
  end_utc: string
  required_skill_ids: string[] | null
  headcount_needed: number
  is_published: boolean
}

type LocationRow = {
  id: string
  name: string
  timezone: string
}

type StaffRow = {
  id: string
  full_name: string
}

type SkillRow = {
  id: string
  name: string
}

type BreakdownItem = {
  label: string
  hours: number
  startUtc: string
  endUtc: string
  pushesOvertime?: boolean
  overOvertime?: boolean
}

type AuditEntry = {
  changed_at: string
  changed_by: string | null
  before_json: Record<string, unknown> | null
  after_json: Record<string, unknown> | null
}

function hoursBetween(startUtc: string, endUtc: string) {
  return (new Date(endUtc).getTime() - new Date(startUtc).getTime()) / (1000 * 60 * 60)
}

function getWeekStartKey(date: Date) {
  const day = date.getUTCDay() || 7
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (day - 1)))
  return monday.toISOString().slice(0, 10)
}

function buildWeeklyBreakdown(assignments: ShiftAssignment[], targetShift?: Shift | null): BreakdownItem[] {
  if (!targetShift) return []
  const targetWeek = getWeekStartKey(new Date(targetShift.startUtc))
  const rows: BreakdownItem[] = assignments
    .filter((assignment) => getWeekStartKey(new Date(assignment.shiftStartUtc)) === targetWeek)
    .map((assignment) => ({
      label: `Shift ${assignment.shiftId}`,
      hours: Number(hoursBetween(assignment.shiftStartUtc, assignment.shiftEndUtc).toFixed(2)),
      startUtc: assignment.shiftStartUtc,
      endUtc: assignment.shiftEndUtc,
    }))

  rows.push({
    label: "Proposed shift",
    hours: Number(hoursBetween(targetShift.startUtc, targetShift.endUtc).toFixed(2)),
    startUtc: targetShift.startUtc,
    endUtc: targetShift.endUtc,
  })

  rows.sort((a, b) => new Date(a.startUtc).getTime() - new Date(b.startUtc).getTime())

  let cumulative = 0
  let flagged = false
  rows.forEach((row) => {
    const before = cumulative
    cumulative += row.hours
    if (!flagged && before < 40 && cumulative >= 40) {
      row.pushesOvertime = true
      flagged = true
      return
    }
    if (flagged && cumulative > 40) {
      row.overOvertime = true
    }
  })

  return rows
}

function formatRange(startUtc: string, endUtc: string, timezone: string) {
  const start = formatInTimeZone(new Date(startUtc), timezone, "MMM d, h:mm a")
  const end = formatInTimeZone(new Date(endUtc), timezone, "MMM d, h:mm a")
  return `${start} → ${end} (${timezone})`
}

function diffKeys(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before && !after) return []
  const keys = new Set<string>([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  return Array.from(keys).filter((key) => (before ?? {})[key] !== (after ?? {})[key])
}

export default function ManagerSchedulePage() {
  const [violations, setViolations] = useState<Violation[]>([])
  const [validationMessage, setValidationMessage] = useState<string>("Select a shift to validate.")
  const [weeklyPreview, setWeeklyPreview] = useState<string>("Select a shift to preview weekly hours.")
  const [overtimePreview, setOvertimePreview] = useState<string>("")
  const [publishStatus, setPublishStatus] = useState<string>("unpublished")
  const [publishMessage, setPublishMessage] = useState<string>("")
  const [realtimeMessage, setRealtimeMessage] = useState<string>("")
  const [overrideReason, setOverrideReason] = useState<string>("")
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [createMessage, setCreateMessage] = useState<string>("")
  const [updateMessage, setUpdateMessage] = useState<string>("")
  const [assignmentMessage, setAssignmentMessage] = useState<string>("")
  const [newHeadcount, setNewHeadcount] = useState<number>(1)
  const [newPublish, setNewPublish] = useState<boolean>(false)
  const [newStart, setNewStart] = useState<string>("")
  const [newEnd, setNewEnd] = useState<string>("")
  const [weekMessage, setWeekMessage] = useState<string>("")
  const [weekStart, setWeekStart] = useState<string>(new Date().toISOString().slice(0, 10))
  const [selectedShiftId, setSelectedShiftId] = useState<string>("")
  const [selectedShift, setSelectedShift] = useState<ShiftRow | null>(null)
  const [selectedLocationId, setSelectedLocationId] = useState<string>("")
  const [selectedSkillId, setSelectedSkillId] = useState<string>("all")
  const [minHeadcount, setMinHeadcount] = useState<number>(1)
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [candidateUserId, setCandidateUserId] = useState<string>("")
  const [candidateAssignments, setCandidateAssignments] = useState<ShiftAssignment[]>([])
  const [candidateSkills, setCandidateSkills] = useState<Skill[]>([])
  const [candidateLocations, setCandidateLocations] = useState<UserLocation[]>([])
  const [candidateAvailability, setCandidateAvailability] = useState<AvailabilityWindow[]>([])
  const [breakdown, setBreakdown] = useState<BreakdownItem[]>([])
  const [requiredSkills, setRequiredSkills] = useState<string[]>([])
  const [staffCandidates, setStaffCandidates] = useState<StaffCandidate[]>([])
  const [editStart, setEditStart] = useState<string>("")
  const [editEnd, setEditEnd] = useState<string>("")
  const [editHeadcount, setEditHeadcount] = useState<number>(1)
  const [editPublish, setEditPublish] = useState<boolean>(false)
  const [editSkillIds, setEditSkillIds] = useState<string[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [assignmentCounts, setAssignmentCounts] = useState<Record<string, number>>({})

  const loadShiftsAndCounts = useCallback(async (locationId: string) => {
    const supabase = createSupabaseBrowserClient()
    const now = new Date()
    const rangeEnd = new Date()
    rangeEnd.setDate(now.getDate() + 21)
    const { data: shiftRows } = await supabase
      .from("shifts")
      .select("id,location_id,start_utc,end_utc,required_skill_ids,headcount_needed,is_published")
      .eq("location_id", locationId)
      .gte("start_utc", now.toISOString())
      .lte("start_utc", rangeEnd.toISOString())
      .order("start_utc")

    const shiftData = (shiftRows ?? []) as ShiftRow[]
    const shiftIds = shiftData.map((shift) => shift.id)
    if (shiftIds.length === 0) {
      setShifts([])
      setAssignmentCounts({})
      return
    }

    const { data: assignmentRows } = await supabase
      .from("shift_assignments")
      .select("shift_id")
      .in("shift_id", shiftIds)
      .neq("status", "dropped")

    const counts: Record<string, number> = {}
    assignmentRows?.forEach((row: any) => {
      if (!row.shift_id) return
      counts[row.shift_id] = (counts[row.shift_id] ?? 0) + 1
    })

    setShifts(shiftData)
    setAssignmentCounts(counts)
  }, [])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const loadReference = async () => {
      const [locRes, skillRes, staffRes] = await Promise.all([
        supabase.from("locations").select("id,name,timezone").order("name"),
        supabase.from("skills").select("id,name").order("name"),
        supabase.from("users").select("id,full_name,role").eq("role", "staff").order("full_name"),
      ])

      if (locRes.data) {
        setLocations(locRes.data as LocationRow[])
        if (!selectedLocationId && locRes.data.length > 0) {
          setSelectedLocationId(locRes.data[0].id)
        }
      }
      if (skillRes.data) {
        setSkills(skillRes.data as SkillRow[])
      }
      if (staffRes.data) {
        const staffRows = staffRes.data.map((row: any) => ({ id: row.id, full_name: row.full_name }))
        setStaff(staffRows)
        if (!candidateUserId && staffRows.length > 0) {
          setCandidateUserId(staffRows[0].id)
        }
      }
    }

    void loadReference()
  }, [candidateUserId, selectedLocationId])

  useEffect(() => {
    if (staff.length === 0) {
      setStaffCandidates([])
      return
    }
    const supabase = createSupabaseBrowserClient()
    const staffIds = staff.map((member) => member.id)
    const loadCandidates = async () => {
      const [assignRes, skillRes, locRes, availRes] = await Promise.all([
        supabase
          .from("shift_assignments")
          .select("id,shift_id,user_id,status,shifts:shifts (start_utc,end_utc)")
          .in("user_id", staffIds)
          .neq("status", "dropped"),
        supabase.from("user_skills").select("user_id,skills:skills (id,name)").in("user_id", staffIds),
        supabase.from("user_locations").select("user_id,location_id,certified_at,revoked_at").in("user_id", staffIds),
        supabase
          .from("availability_windows")
          .select("user_id,day_of_week,start_local_time,end_local_time,exception_date,is_unavailable")
          .in("user_id", staffIds),
      ])

      const assignmentsByUser = new Map<string, ShiftAssignment[]>()
      assignRes.data?.forEach((row: any) => {
        if (!row.user_id) return
        const entry: ShiftAssignment = {
          id: row.id,
          shiftId: row.shift_id,
          userId: row.user_id,
          status: row.status,
          shiftStartUtc: row.shifts?.start_utc,
          shiftEndUtc: row.shifts?.end_utc,
        }
        const current = assignmentsByUser.get(row.user_id) ?? []
        current.push(entry)
        assignmentsByUser.set(row.user_id, current)
      })

      const skillsByUser = new Map<string, Skill[]>()
      skillRes.data?.forEach((row: any) => {
        if (!row.user_id) return
        const entry: Skill = { id: row.skills?.id, name: row.skills?.name }
        const current = skillsByUser.get(row.user_id) ?? []
        if (entry.id) current.push(entry)
        skillsByUser.set(row.user_id, current)
      })

      const locationsByUser = new Map<string, UserLocation[]>()
      locRes.data?.forEach((row: any) => {
        if (!row.user_id) return
        const entry: UserLocation = {
          userId: row.user_id,
          locationId: row.location_id,
          certifiedAt: row.certified_at,
          revokedAt: row.revoked_at,
        }
        const current = locationsByUser.get(row.user_id) ?? []
        current.push(entry)
        locationsByUser.set(row.user_id, current)
      })

      const availabilityByUser = new Map<string, AvailabilityWindow[]>()
      availRes.data?.forEach((row: any) => {
        if (!row.user_id) return
        const entry: AvailabilityWindow = {
          userId: row.user_id,
          dayOfWeek: row.day_of_week,
          startLocalTime: row.start_local_time,
          endLocalTime: row.end_local_time,
          exceptionDate: row.exception_date,
          isUnavailable: row.is_unavailable,
        }
        const current = availabilityByUser.get(row.user_id) ?? []
        current.push(entry)
        availabilityByUser.set(row.user_id, current)
      })

      const candidates: StaffCandidate[] = staffIds.map((userId) => ({
        userId,
        assignments: assignmentsByUser.get(userId) ?? [],
        skills: skillsByUser.get(userId) ?? [],
        locations: locationsByUser.get(userId) ?? [],
        availability: availabilityByUser.get(userId) ?? [],
      }))

      setStaffCandidates(candidates)
    }

    void loadCandidates()
  }, [staff])

  useEffect(() => {
    if (!selectedLocationId) return
    void loadShiftsAndCounts(selectedLocationId)
  }, [selectedLocationId, loadShiftsAndCounts])

  useEffect(() => {
    if (!candidateUserId) return
    const supabase = createSupabaseBrowserClient()
    const loadCandidate = async () => {
      const [assignRes, skillRes, locRes, availRes] = await Promise.all([
        supabase
          .from("shift_assignments")
          .select("id,shift_id,user_id,status,shifts:shifts (start_utc,end_utc)")
          .eq("user_id", candidateUserId)
          .neq("status", "dropped"),
        supabase.from("user_skills").select("skills:skills (id,name)").eq("user_id", candidateUserId),
        supabase.from("user_locations").select("user_id,location_id,certified_at,revoked_at").eq("user_id", candidateUserId),
        supabase
          .from("availability_windows")
          .select("user_id,day_of_week,start_local_time,end_local_time,exception_date,is_unavailable")
          .eq("user_id", candidateUserId),
      ])

      const assignments: ShiftAssignment[] =
        assignRes.data?.map((row: any) => ({
          id: row.id,
          shiftId: row.shift_id,
          userId: row.user_id,
          status: row.status,
          shiftStartUtc: row.shifts?.start_utc,
          shiftEndUtc: row.shifts?.end_utc,
        })) ?? []

      const skillRows: Skill[] =
        skillRes.data?.map((row: any) => ({ id: row.skills?.id, name: row.skills?.name })) ?? []

      const locationRows: UserLocation[] =
        locRes.data?.map((row: any) => ({
          userId: row.user_id,
          locationId: row.location_id,
          certifiedAt: row.certified_at,
          revokedAt: row.revoked_at,
        })) ?? []

      const availabilityRows: AvailabilityWindow[] =
        availRes.data?.map((row: any) => ({
          userId: row.user_id,
          dayOfWeek: row.day_of_week,
          startLocalTime: row.start_local_time,
          endLocalTime: row.end_local_time,
          exceptionDate: row.exception_date,
          isUnavailable: row.is_unavailable,
        })) ?? []

      setCandidateAssignments(assignments)
      setCandidateSkills(skillRows)
      setCandidateLocations(locationRows)
      setCandidateAvailability(availabilityRows)
    }

    void loadCandidate()
  }, [candidateUserId])

  useEffect(() => {
    if (!selectedLocationId && !candidateUserId) return
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel("schedule-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => {
        if (!selectedLocationId) return
        void loadShiftsAndCounts(selectedLocationId).then(() => {
          setRealtimeMessage("Schedule updated in realtime.")
        })
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_assignments" }, () => {
        if (!candidateUserId) return
        if (selectedLocationId) {
          void loadShiftsAndCounts(selectedLocationId).then(() => {
            setRealtimeMessage("Assignments updated in realtime.")
          })
        }
        supabase
          .from("shift_assignments")
          .select("id,shift_id,user_id,status,shifts:shifts (start_utc,end_utc)")
          .eq("user_id", candidateUserId)
          .neq("status", "dropped")
          .then(({ data }) => {
            const assignments: ShiftAssignment[] =
              data?.map((row: any) => ({
                id: row.id,
                shiftId: row.shift_id,
                userId: row.user_id,
                status: row.status,
                shiftStartUtc: row.shifts?.start_utc,
                shiftEndUtc: row.shifts?.end_utc,
              })) ?? []
            setCandidateAssignments(assignments)
          })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [candidateUserId, selectedLocationId, loadShiftsAndCounts])

  useEffect(() => {
    if (!selectedShift) return
    setEditStart(selectedShift.start_utc.slice(0, 16))
    setEditEnd(selectedShift.end_utc.slice(0, 16))
    setEditHeadcount(selectedShift.headcount_needed ?? 1)
    setEditPublish(Boolean(selectedShift.is_published))
    setEditSkillIds(selectedShift.required_skill_ids ?? [])
    setPublishStatus(selectedShift.is_published ? "published" : "unpublished")
  }, [selectedShift])

  useEffect(() => {
    if (!selectedShiftId) {
      setAuditEntries([])
      return
    }
    const supabase = createSupabaseBrowserClient()
    supabase
      .from("audit_logs")
      .select("changed_at,changed_by,before_json,after_json,entity_type,entity_id")
      .eq("entity_type", "shifts")
      .eq("entity_id", selectedShiftId)
      .order("changed_at", { ascending: false })
      .then(({ data }) => {
        setAuditEntries((data ?? []) as AuditEntry[])
      })
  }, [selectedShiftId])

  const locationTimezone =
    locations.find((location) => location.id === selectedLocationId)?.timezone ?? "UTC"

  const staffNameById = useMemo(() => {
    return new Map(staff.map((member) => [member.id, member.full_name]))
  }, [staff])

  const filteredShifts = useMemo(() => {
    return shifts.filter((shift) => {
      const meetsHeadcount = (shift.headcount_needed ?? 1) >= minHeadcount
      const meetsSkill =
        selectedSkillId === "all" ||
        (shift.required_skill_ids ?? []).includes(selectedSkillId)
      return meetsHeadcount && meetsSkill
    })
  }, [minHeadcount, selectedSkillId, shifts])

  const events = useMemo(
    () =>
      filteredShifts.map((shift) => {
        const filled = assignmentCounts[shift.id] ?? 0
        const headcount = shift.headcount_needed ?? 1
        return {
          id: shift.id,
          title: `${shift.is_published ? "Published" : "Draft"} · ${filled}/${headcount} filled`,
          start: shift.start_utc,
          end: shift.end_utc,
        }
      }),
    [assignmentCounts, filteredShifts],
  )

  const runValidation = async (targetShift: Shift) => {
    const projected = calculateWeeklyHours([
      ...candidateAssignments.map((assignment) => ({
        userId: assignment.userId,
        startUtc: assignment.shiftStartUtc,
        endUtc: assignment.shiftEndUtc,
      })),
      { userId: candidateUserId, startUtc: targetShift.startUtc, endUtc: targetShift.endUtc },
    ])
    const preview = projected.find((entry) => entry.userId === candidateUserId)
    if (preview) {
      setWeeklyPreview(`Projected weekly hours: ${preview.totalHours} (week of ${preview.weekStartUtc}).`)
      const overtimeHours = Math.max(0, preview.totalHours - 40)
      const overtimeCost = overtimeHours * 25
      setOvertimePreview(
        overtimeHours > 0
          ? `Projected overtime: ${overtimeHours.toFixed(1)} hrs (~$${overtimeCost.toFixed(2)}). Assignment selection pushes overtime.`
          : "Projected overtime: none.",
      )
    } else {
      setWeeklyPreview("Projected weekly hours: unavailable.")
      setOvertimePreview("")
    }

    const result = await validateAssignment(
      candidateUserId,
      targetShift,
      candidateAssignments,
      candidateSkills,
      candidateLocations,
      candidateAvailability,
      staffCandidates,
    )
    setViolations(result.violations)
    setValidationMessage(result.valid ? "Shift is valid for assignment." : "Shift has validation issues.")
    setSuggestions(
      result.suggestions
        .filter((item) => item.userId !== candidateUserId)
        .map((item) => staffNameById.get(item.userId) ?? item.userId),
    )
    setBreakdown(buildWeeklyBreakdown(candidateAssignments, targetShift))
  }

  const handleSelect = async (info: DateSelectArg) => {
    if (!selectedLocationId) return
    const targetShift: Shift = {
      id: crypto.randomUUID(),
      locationId: selectedLocationId,
      locationTimezone: locationTimezone,
      startUtc: info.start.toISOString(),
      endUtc: info.end.toISOString(),
      requiredSkillIds: requiredSkills,
    }
    setSelectedShiftId("")
    setSelectedShift(null)
    await runValidation(targetShift)
  }

  const handleDrop = async (info: EventDropArg) => {
    if (!info.event.start || !info.event.end || !selectedLocationId) return
    const targetShift: Shift = {
      id: info.event.id,
      locationId: selectedLocationId,
      locationTimezone: locationTimezone,
      startUtc: info.event.start.toISOString(),
      endUtc: info.event.end.toISOString(),
      requiredSkillIds: requiredSkills,
    }
    await runValidation(targetShift)
  }

  const handleClick = async (info: EventClickArg) => {
    const shift = shifts.find((item) => item.id === info.event.id)
    if (!shift) return
    setSelectedShiftId(shift.id)
    setSelectedShift(shift)
    await runValidation({
      id: shift.id,
      locationId: shift.location_id,
      locationTimezone: locationTimezone,
      startUtc: shift.start_utc,
      endUtc: shift.end_utc,
      requiredSkillIds: shift.required_skill_ids ?? [],
    })
  }

  const handlePublish = async (action: "publish" | "unpublish") => {
    if (!selectedShiftId) {
      setPublishMessage("Select a shift to publish or unpublish.")
      return
    }
    setPublishMessage("")
    const response = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, shiftId: selectedShiftId, overrideReason }),
    })
    const data = await response.json()
    if (!data.ok) {
      setPublishMessage(data.message ?? "Unable to update publish status.")
      return
    }
    setPublishStatus(action === "publish" ? "published" : "unpublished")
    setPublishMessage(`Shift is now ${action === "publish" ? "published" : "unpublished"}.`)
  }

  const handlePublishWeek = async (action: "publish_week" | "unpublish_week") => {
    setWeekMessage("")
    const response = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        weekStart: `${weekStart}T00:00:00.000Z`,
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      setWeekMessage(data.error ?? "Unable to update weekly publish state.")
      return
    }
    setWeekMessage(action === "publish_week" ? "Week published." : "Week unpublished.")
  }

  const handleCreateShift = async () => {
    if (!selectedLocationId) {
      setCreateMessage("Select a location before creating a shift.")
      return
    }
    if (!newStart || !newEnd) {
      setCreateMessage("Start and end times are required.")
      return
    }
    if (requiredSkills.length === 0) {
      setCreateMessage("Select at least one required skill.")
      return
    }
    if (Number.isNaN(newHeadcount) || newHeadcount < 1) {
      setCreateMessage("Headcount must be at least 1.")
      return
    }
    setCreateMessage("")
    const response = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        shift: {
          location_id: selectedLocationId,
          start_utc: new Date(newStart).toISOString(),
          end_utc: new Date(newEnd).toISOString(),
          required_skill_ids: requiredSkills,
          headcount_needed: newHeadcount,
          is_published: newPublish,
        },
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      setCreateMessage(data.error ?? "Unable to create shift.")
      return
    }
    setCreateMessage("Shift created.")
  }

  const handleUpdateShift = async () => {
    if (!selectedShiftId) {
      setUpdateMessage("Select a shift to edit.")
      return
    }
    setUpdateMessage("")
    const response = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        shiftId: selectedShiftId,
        shift: {
          start_utc: new Date(editStart).toISOString(),
          end_utc: new Date(editEnd).toISOString(),
          headcount_needed: editHeadcount,
          required_skill_ids: editSkillIds,
          is_published: editPublish,
        },
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      setUpdateMessage(data.error ?? "Unable to update shift.")
      return
    }
    setUpdateMessage("Shift updated.")
  }

  const handleAssign = async () => {
    if (!selectedShiftId || !candidateUserId) {
      setAssignmentMessage("Select a shift and staff member before assigning.")
      return
    }
    setAssignmentMessage("")
    const response = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateUserId,
        shiftId: selectedShiftId,
        overrideReason: overrideReason || undefined,
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      setAssignmentMessage(formatAssignmentError(data.error, data.message ?? data.error ?? "Assignment failed."))
      return
    }
    if (!data.result?.valid) {
      setAssignmentMessage("Assignment blocked. Review validation output.")
      return
    }
    setAssignmentMessage("Assignment confirmed.")
  }

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Manager Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Build schedules with headcount, skill filters, and live validation.
        </p>
      </div>

      <section className="grid gap-4 rounded-lg border border-border bg-background p-4 md:grid-cols-2">
        <div>
          <div className="text-sm text-muted-foreground">Location</div>
          <select
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={selectedLocationId}
            onChange={(event) => setSelectedLocationId(event.target.value)}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} ({location.timezone})
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Staff member</div>
          <select
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={candidateUserId}
            onChange={(event) => setCandidateUserId(event.target.value)}
          >
            {staff.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Filter by skill</div>
          <select
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={selectedSkillId}
            onChange={(event) => setSelectedSkillId(event.target.value)}
          >
            <option value="all">All skills</option>
            {skills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Minimum headcount</div>
          <input
            type="number"
            min={1}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={minHeadcount}
            onChange={(event) => setMinHeadcount(Number(event.target.value))}
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">Publish state</div>
            <div className="text-lg font-semibold capitalize">{publishStatus}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {selectedShift
                ? `Filled: ${assignmentCounts[selectedShift.id] ?? 0}/${selectedShift.headcount_needed ?? 1}`
                : "Select a shift to view headcount filled."}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              onClick={() => handlePublish("publish")}
            >
              Publish
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              onClick={() => handlePublish("unpublish")}
            >
              Unpublish
            </button>
          </div>
        </div>
        <div className="mt-3">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Override reason (admin)</label>
          <input
            type="text"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Required if unpublishing after cutoff or overriding 7th day"
            value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)}
          />
        </div>
        {publishMessage && (
          <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {publishMessage}
          </div>
        )}
        {realtimeMessage && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {realtimeMessage}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Unpublish is blocked within 48 hours of the shift start (admin override required).
        </p>
      </section>

      <section className="rounded-lg border border-border bg-background p-4">
        <h2 className="text-lg font-semibold">Weekly Publish</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <input
            type="date"
            className="rounded-md border border-border bg-background px-3 py-2"
            value={weekStart}
            onChange={(event) => setWeekStart(event.target.value)}
          />
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={() => handlePublishWeek("publish_week")}
          >
            Publish week
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={() => handlePublishWeek("unpublish_week")}
          >
            Unpublish week
          </button>
          {weekMessage && <span className="text-sm text-muted-foreground">{weekMessage}</span>}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-4">
        <h2 className="text-lg font-semibold">Create Shift</h2>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Start</label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={newStart}
              onChange={(event) => setNewStart(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">End</label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={newEnd}
              onChange={(event) => setNewEnd(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Headcount</label>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={newHeadcount}
              onChange={(event) => setNewHeadcount(Number(event.target.value))}
            />
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Required skills</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {skills.map((skill) => (
                <label key={skill.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={requiredSkills.includes(skill.id)}
                    onChange={(event) => {
                      setRequiredSkills((current) =>
                        event.target.checked
                          ? [...current, skill.id]
                          : current.filter((id) => id !== skill.id),
                      )
                    }}
                  />
                  <span>{skill.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={newPublish}
                onChange={(event) => setNewPublish(event.target.checked)}
              />
              <span>Publish on create</span>
            </label>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              onClick={handleCreateShift}
            >
              Create shift
            </button>
          </div>
        </div>
        {createMessage && <div className="mt-3 text-sm text-muted-foreground">{createMessage}</div>}
      </section>

      <section className="rounded-lg border border-border bg-background p-4">
        <h2 className="text-lg font-semibold">Edit Shift</h2>
        <p className="text-sm text-muted-foreground">Select a shift on the calendar to edit details.</p>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Start</label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={editStart}
              onChange={(event) => setEditStart(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">End</label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={editEnd}
              onChange={(event) => setEditEnd(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Headcount</label>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={editHeadcount}
              onChange={(event) => setEditHeadcount(Number(event.target.value))}
            />
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Required skills</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {skills.map((skill) => (
                <label key={skill.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={editSkillIds.includes(skill.id)}
                    onChange={(event) => {
                      setEditSkillIds((current) =>
                        event.target.checked
                          ? [...current, skill.id]
                          : current.filter((id) => id !== skill.id),
                      )
                    }}
                  />
                  <span>{skill.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={editPublish}
                onChange={(event) => setEditPublish(event.target.checked)}
              />
              <span>Published</span>
            </label>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              onClick={handleUpdateShift}
            >
              Update shift
            </button>
          </div>
        </div>
        {updateMessage && <div className="mt-3 text-sm text-muted-foreground">{updateMessage}</div>}
      </section>

      <div className="rounded-lg border border-border bg-background p-4">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          height={600}
          selectable
          editable
          events={events}
          select={handleSelect}
          eventDrop={handleDrop}
          eventClick={handleClick}
          nowIndicator
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
        />
      </div>

      <section className="rounded-lg border border-border bg-muted/30 p-4">
        <h2 className="text-lg font-semibold">Validation Output</h2>
        <p className="text-sm text-muted-foreground">{validationMessage}</p>
        <div className="mt-3 space-y-2 text-sm">
          {violations.length === 0 ? (
            <p className="text-emerald-600">No violations.</p>
          ) : (
            violations.map((violation) => (
              <div key={`${violation.rule}-${violation.message}`} className="rounded-md border border-border bg-background p-3">
                <div className="font-medium">{violation.rule}</div>
                <div className="text-muted-foreground">{violation.message}</div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{violation.severity}</div>
              </div>
            ))
          )}
        </div>
        {violations.length > 0 && (
          <div className="mt-4 rounded-md border border-border bg-background p-3">
            <div className="text-sm font-semibold">Suggested Alternatives</div>
            {suggestions.length === 0 ? (
              <div className="text-sm text-muted-foreground">No suggestions available.</div>
            ) : (
              <div className="text-sm text-muted-foreground">{suggestions.join(", ")} available and qualified.</div>
            )}
          </div>
        )}
        <div className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
          {weeklyPreview}
        </div>
        {overtimePreview && (
          <div className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            {overtimePreview}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Overtime Breakdown</h2>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={handleAssign}
          >
            Confirm assignment
          </button>
        </div>
        {assignmentMessage && (
          <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {assignmentMessage}
          </div>
        )}
        {breakdown.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Select a shift to see weekly contribution.</p>
        ) : (
          <div className="mt-3 space-y-2 text-sm">
            {breakdown.map((item) => (
              <div
                key={`${item.label}-${item.startUtc}`}
                className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                  item.pushesOvertime
                    ? "border-amber-300 bg-amber-50"
                    : item.overOvertime
                      ? "border-amber-200 bg-amber-50/60"
                      : "border-border bg-muted/10"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <span>{item.label}</span>
                    {item.pushesOvertime && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Overtime Trigger
                      </span>
                    )}
                    {item.overOvertime && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Overtime
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatRange(item.startUtc, item.endUtc, locationTimezone)}
                  </div>
                </div>
                <div className="text-sm font-semibold">{item.hours} hrs</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-background p-4">
        <h2 className="text-lg font-semibold">Shift History</h2>
        {!selectedShiftId ? (
          <p className="mt-2 text-sm text-muted-foreground">Select a shift to view audit history.</p>
        ) : auditEntries.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No audit entries yet.</p>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            {auditEntries.map((entry) => (
              <div key={`${entry.changed_at}-${entry.changed_by ?? "system"}`} className="rounded-md border border-border bg-muted/10 p-3">
                <div className="font-medium">
                  {formatInTimeZone(new Date(entry.changed_at), locationTimezone, "MMM d, h:mm a")} ·{" "}
                  {entry.changed_by ?? "system"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Fields changed: {diffKeys(entry.before_json, entry.after_json).join(", ") || "n/a"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
