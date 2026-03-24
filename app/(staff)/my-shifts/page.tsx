"use client"

import { useEffect, useState } from "react"
import { formatInTimeZone } from "date-fns-tz"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

type NotificationItem = {
  id: string
  title: string
  body: string
  is_read: boolean
  created_at: string
}

type NotificationType = "swap" | "drop" | "schedule" | "overtime" | "availability" | "other"

type SkillRow = {
  id: string
  name: string
}

type UserSkillRow = {
  user_id: string
  skill_id: string
}

function getNotificationType(title: string): NotificationType {
  const value = title.toLowerCase()
  if (value.includes("swap")) return "swap"
  if (value.includes("drop")) return "drop"
  if (value.includes("overtime")) return "overtime"
  if (value.includes("availability")) return "availability"
  if (value.includes("publish") || value.includes("schedule")) return "schedule"
  return "other"
}

export default function StaffMyShiftsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [status, setStatus] = useState("Loading notifications...")
  const [actionStatus, setActionStatus] = useState("")
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [userSkills, setUserSkills] = useState<UserSkillRow[]>([])
  const [skillsStatus, setSkillsStatus] = useState("")
  const [assignments, setAssignments] = useState<
    Array<{
      id: string
      start_utc: string
      end_utc: string
      location_id: string
      location_timezone: string
      location_name: string
      is_published?: boolean
    }>
  >([])
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all")
  const [typeFilter, setTypeFilter] = useState<"all" | NotificationType>("all")

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()

    const setup = async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        setStatus("Please sign in to view notifications.")
        return
      }

      const { data: assignmentRows } = await supabase
        .from("shift_assignments")
        .select("id,shifts:shifts (start_utc,end_utc,location_id,is_published,locations:locations (timezone,name))")
        .eq("user_id", userData.user.id)
        .neq("status", "dropped")

      setAssignments(
        (assignmentRows ?? []).map((row: any) => ({
          id: row.id,
          start_utc: row.shifts?.start_utc,
          end_utc: row.shifts?.end_utc,
          location_id: row.shifts?.location_id,
          location_timezone: row.shifts?.locations?.timezone ?? "UTC",
          location_name: row.shifts?.locations?.name ?? row.shifts?.location_id,
          is_published: row.shifts?.is_published,
        })),
      )

      const [skillRes, userSkillRes] = await Promise.all([
        supabase.from("skills").select("id,name").order("name"),
        supabase.from("user_skills").select("user_id,skill_id").eq("user_id", userData.user.id),
      ])

      if (skillRes.error || userSkillRes.error) {
        setSkillsStatus("Unable to load skills.")
      } else {
        setSkills((skillRes.data ?? []) as SkillRow[])
        setUserSkills((userSkillRes.data ?? []) as UserSkillRow[])
      }

      const { data, error } = await supabase
        .from("notifications")
        .select("id,title,body,is_read,created_at")
        .eq("user_id", userData.user.id)
        .order("created_at", { ascending: false })

      if (error) {
        setStatus("Unable to load notifications.")
        return
      }

      setNotifications((data ?? []) as NotificationItem[])
      setStatus("")

      const channel = supabase
        .channel("notifications-stream")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userData.user.id}`,
          },
          (payload) => {
            setNotifications((current) => [payload.new as NotificationItem, ...current])
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "shift_assignments",
            filter: `user_id=eq.${userData.user.id}`,
          },
          () => {
            supabase
              .from("shift_assignments")
              .select("id,shifts:shifts (start_utc,end_utc,location_id,is_published,locations:locations (timezone,name))")
              .eq("user_id", userData.user.id)
              .neq("status", "dropped")
              .then(({ data: rows }) => {
                setAssignments(
                  (rows ?? []).map((row: any) => ({
                    id: row.id,
                    start_utc: row.shifts?.start_utc,
                    end_utc: row.shifts?.end_utc,
                    location_id: row.shifts?.location_id,
                    location_timezone: row.shifts?.locations?.timezone ?? "UTC",
                    location_name: row.shifts?.locations?.name ?? row.shifts?.location_id,
                    is_published: row.shifts?.is_published,
                  })),
                )
              })
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "shifts" },
          () => {
            setActionStatus("Schedule updated.")
            supabase
              .from("shift_assignments")
              .select("id,shifts:shifts (start_utc,end_utc,location_id,is_published,locations:locations (timezone,name))")
              .eq("user_id", userData.user.id)
              .neq("status", "dropped")
              .then(({ data: rows }) => {
                setAssignments(
                  (rows ?? []).map((row: any) => ({
                    id: row.id,
                    start_utc: row.shifts?.start_utc,
                    end_utc: row.shifts?.end_utc,
                    location_id: row.shifts?.location_id,
                    location_timezone: row.shifts?.locations?.timezone ?? "UTC",
                    location_name: row.shifts?.locations?.name ?? row.shifts?.location_id,
                    is_published: row.shifts?.is_published,
                  })),
                )
              })
          },
        )
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }

    const cleanupPromise = setup()
    return () => {
      void cleanupPromise.then((cleanup) => cleanup && cleanup())
    }
  }, [])

  const markAsRead = async (id: string) => {
    const supabase = createSupabaseBrowserClient()
    setActionStatus("")
    const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id)
    if (error) {
      setActionStatus("Unable to mark notification as read.")
      return
    }
    setNotifications((current) =>
      current.map((item) => (item.id === id ? { ...item, is_read: true } : item)),
    )
  }

  const markAllRead = async () => {
    const supabase = createSupabaseBrowserClient()
    setActionStatus("")
    const ids = notifications.filter((item) => !item.is_read).map((item) => item.id)
    if (ids.length === 0) return
    const { error } = await supabase.from("notifications").update({ is_read: true }).in("id", ids)
    if (error) {
      setActionStatus("Unable to mark notifications as read.")
      return
    }
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true })))
  }

  const filteredNotifications = notifications.filter((item) => {
    if (readFilter === "unread" && item.is_read) return false
    if (readFilter === "read" && !item.is_read) return false
    if (typeFilter !== "all" && getNotificationType(item.title) !== typeFilter) return false
    return true
  })

  const skillsMap = new Map(skills.map((skill) => [skill.id, skill.name]))
  const skillNames = userSkills
    .map((entry) => skillsMap.get(entry.skill_id))
    .filter((name): name is string => Boolean(name))

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Notification Center</h1>
        <p className="text-sm text-muted-foreground">
          Realtime notifications appear here when your schedule changes.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-background p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {notifications.filter((item) => !item.is_read).length} unread
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={readFilter}
              onChange={(event) => setReadFilter(event.target.value as "all" | "unread" | "read")}
            >
              <option value="all">All</option>
              <option value="unread">Unread</option>
              <option value="read">Read</option>
            </select>
            <select
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as "all" | NotificationType)}
            >
              <option value="all">All types</option>
              <option value="swap">Swap</option>
              <option value="drop">Drop</option>
              <option value="schedule">Schedule</option>
              <option value="overtime">Overtime</option>
              <option value="availability">Availability</option>
              <option value="other">Other</option>
            </select>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              onClick={markAllRead}
            >
              Mark all read
            </button>
          </div>
        </div>

        {actionStatus && (
          <div className="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {actionStatus}
          </div>
        )}

        {status ? (
          <p className="text-sm text-muted-foreground">{status}</p>
        ) : filteredNotifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          <div className="space-y-3">
            {filteredNotifications.map((item) => (
              <div
                key={item.id}
                className={`rounded-md border border-border p-3 ${
                  item.is_read ? "bg-background" : "bg-muted/30"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{item.title}</div>
                  {!item.is_read && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                      Unread
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">{item.body}</div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>
                    {getNotificationType(item.title)} · {new Date(item.created_at).toLocaleString()}
                  </span>
                  {!item.is_read && (
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                      onClick={() => markAsRead(item.id)}
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-background p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">My Skills</h2>
            <p className="text-sm text-muted-foreground">Your current certifications and specialties.</p>
          </div>
          {skillsStatus && <span className="text-sm text-muted-foreground">{skillsStatus}</span>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          {skillNames.length === 0 ? (
            <p className="text-sm text-muted-foreground">No skills assigned yet.</p>
          ) : (
            skillNames.map((skill) => (
              <span key={skill} className="rounded-full border border-border bg-muted/20 px-3 py-1 text-xs">
                {skill}
              </span>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">Upcoming Assignments</h2>
        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming assignments.</p>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="rounded-md border border-border bg-muted/20 p-3">
                <div className="font-medium">Assignment {assignment.id}</div>
                <div className="text-muted-foreground">
                  {formatInTimeZone(new Date(assignment.start_utc), assignment.location_timezone, "MMM d, h:mm a")} →{" "}
                  {formatInTimeZone(new Date(assignment.end_utc), assignment.location_timezone, "MMM d, h:mm a")}
                </div>
                <div className="text-xs text-muted-foreground">
                  Location: {assignment.location_name} · {assignment.is_published ? "Published" : "Unpublished"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
