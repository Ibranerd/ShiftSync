"use client"

import { useEffect, useMemo, useState } from "react"
import FullCalendar from "@fullcalendar/react"
import dayGridPlugin from "@fullcalendar/daygrid"
import timeGridPlugin from "@fullcalendar/timegrid"
import interactionPlugin, { DateSelectArg, EventDropArg } from "@fullcalendar/interaction"
// FullCalendar v6 no longer ships CSS files in npm packages.
// Add custom styles in globals.css if needed.

import {
  validateAssignment,
  type AvailabilityWindow,
  type Shift,
  type ShiftAssignment,
  type UserLocation,
  type Skill,
  type Violation,
} from "@/lib/constraint-engine"
import { calculateWeeklyHours } from "@/lib/overtime"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

const CANDIDATE_USER_ID = "user-1"

const baseAssignments: ShiftAssignment[] = [
  {
    id: "assign-1",
    shiftId: "shift-1",
    userId: CANDIDATE_USER_ID,
    status: "assigned",
    shiftStartUtc: "2025-01-10T14:00:00.000Z",
    shiftEndUtc: "2025-01-10T22:00:00.000Z",
  },
  {
    id: "assign-2",
    shiftId: "shift-2",
    userId: CANDIDATE_USER_ID,
    status: "confirmed",
    shiftStartUtc: "2025-01-11T14:00:00.000Z",
    shiftEndUtc: "2025-01-11T22:00:00.000Z",
  },
]

const userSkills: Skill[] = [{ id: "skill-1", name: "Barista" }]

const userLocations: UserLocation[] = [
  {
    userId: CANDIDATE_USER_ID,
    locationId: "loc-nyc",
    certifiedAt: "2024-12-01T00:00:00.000Z",
    revokedAt: null,
  },
]

const availabilityWindows: AvailabilityWindow[] = [
  {
    userId: CANDIDATE_USER_ID,
    dayOfWeek: 5,
    startLocalTime: "08:00:00",
    endLocalTime: "20:00:00",
    isUnavailable: false,
  },
  {
    userId: CANDIDATE_USER_ID,
    dayOfWeek: 6,
    startLocalTime: "08:00:00",
    endLocalTime: "20:00:00",
    isUnavailable: false,
  },
]

const staffCandidates = [
  {
    userId: "user-2",
    skills: [{ id: "skill-1", name: "Barista" }],
    locations: [
      {
        userId: "user-2",
        locationId: "loc-nyc",
        certifiedAt: "2024-12-01T00:00:00.000Z",
        revokedAt: null,
      },
    ],
    availability: [
      {
        userId: "user-2",
        dayOfWeek: 5,
        startLocalTime: "08:00:00",
        endLocalTime: "20:00:00",
        isUnavailable: false,
      },
    ],
    assignments: [],
  },
]

function toShift(startStr: string, endStr: string): Shift {
  return {
    id: crypto.randomUUID(),
    locationId: "loc-nyc",
    locationTimezone: "America/New_York",
    startUtc: startStr,
    endUtc: endStr,
    requiredSkillIds: ["skill-1"],
  }
}

export default function ManagerSchedulePage() {
  const [violations, setViolations] = useState<Violation[]>([])
  const [validationMessage, setValidationMessage] = useState<string>("Select or drag a shift to validate.")
  const [weeklyPreview, setWeeklyPreview] = useState<string>("Select a shift to preview weekly hours.")
  const [overtimePreview, setOvertimePreview] = useState<string>("")
  const [publishStatus, setPublishStatus] = useState<string>("unpublished")
  const [publishMessage, setPublishMessage] = useState<string>("")
  const [realtimeMessage, setRealtimeMessage] = useState<string>("")
  const [overrideReason, setOverrideReason] = useState<string>("")
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [createMessage, setCreateMessage] = useState<string>("")
  const [newHeadcount, setNewHeadcount] = useState<number>(1)
  const [newPublish, setNewPublish] = useState<boolean>(false)
  const [newStart, setNewStart] = useState<string>("2025-01-15T14:00")
  const [newEnd, setNewEnd] = useState<string>("2025-01-15T22:00")

  const events = useMemo(
    () =>
      baseAssignments.map((assignment) => ({
        id: assignment.id,
        title: `Assigned shift`,
        start: assignment.shiftStartUtc,
        end: assignment.shiftEndUtc,
      })),
    [],
  )

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const publishChannel = supabase
      .channel("shift-publish-updates")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "shifts" },
        () => {
          setRealtimeMessage("Schedule publish status updated in realtime.")
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(publishChannel)
    }
  }, [])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const conflictChannel = supabase
      .channel("assignment-conflicts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "shift_assignments" },
        () => {
          setRealtimeMessage("Concurrent assignment detected. Please refresh assignments.")
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(conflictChannel)
    }
  }, [])

  const handleValidate = async (start: Date, end: Date) => {
    const targetShift = toShift(start.toISOString(), end.toISOString())
    const projected = calculateWeeklyHours([
      ...baseAssignments.map((assignment) => ({
        userId: assignment.userId,
        startUtc: assignment.shiftStartUtc,
        endUtc: assignment.shiftEndUtc,
      })),
      { userId: CANDIDATE_USER_ID, startUtc: targetShift.startUtc, endUtc: targetShift.endUtc },
    ])
    const preview = projected.find((entry) => entry.userId === CANDIDATE_USER_ID)
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
      CANDIDATE_USER_ID,
      targetShift,
      baseAssignments,
      userSkills,
      userLocations,
      availabilityWindows,
      staffCandidates,
    )
    setViolations(result.violations)
    setValidationMessage(result.valid ? "Shift is valid for assignment." : "Shift has validation issues.")
    setSuggestions(result.suggestions.map((item) => item.userId))
  }

  const handleSelect = async (info: DateSelectArg) => {
    await handleValidate(info.start, info.end)
  }

  const handleDrop = async (info: EventDropArg) => {
    if (!info.event.start || !info.event.end) return
    await handleValidate(info.event.start, info.event.end)
  }

  const handlePublish = async (action: "publish" | "unpublish") => {
    setPublishMessage("")
    const response = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, shiftId: "shift-1", overrideReason }),
    })
    const data = await response.json()
    if (!data.ok) {
      setPublishMessage(data.message ?? "Unable to update publish status.")
      return
    }
    setPublishStatus(action === "publish" ? "published" : "unpublished")
    setPublishMessage(`Shift is now ${action === "publish" ? "published" : "unpublished"}.`)
  }

  const handleCreateShift = async () => {
    setCreateMessage("")
    const response = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        shift: {
          location_id: "loc-nyc",
          start_utc: new Date(newStart).toISOString(),
          end_utc: new Date(newEnd).toISOString(),
          required_skill_ids: ["skill-1"],
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

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Manager Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Drag or select a shift to preview assignment validation.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">Publish state</div>
            <div className="text-lg font-semibold capitalize">{publishStatus}</div>
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
            placeholder="Required if unpublishing after cutoff"
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
          <div className="mt-3 rounded-md border border-border bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {realtimeMessage}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Unpublish is blocked within 48 hours of the shift start (admin override required).
        </p>
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
        <div className="mt-3 flex items-center gap-3 text-sm">
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
          {createMessage && <span className="text-sm text-muted-foreground">{createMessage}</span>}
        </div>
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
              <div className="text-sm text-muted-foreground">
                {suggestions.join(", ")} available and qualified.
              </div>
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
    </main>
  )
}
