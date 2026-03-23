"use client"

import { useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

type NotificationItem = {
  id: string
  title: string
  body: string
  is_read: boolean
  created_at: string
}

export default function StaffMyShiftsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [status, setStatus] = useState("Loading notifications...")
  const [actionStatus, setActionStatus] = useState("")
  const [assignments, setAssignments] = useState<Array<{ id: string; start_utc: string; end_utc: string; location_id: string; is_published?: boolean }>>([])

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
        .select("id,shifts:shifts (start_utc,end_utc,location_id,is_published)")
        .eq("user_id", userData.user.id)
        .neq("status", "dropped")

      setAssignments(
        (assignmentRows ?? []).map((row: any) => ({
          id: row.id,
          start_utc: row.shifts?.start_utc,
          end_utc: row.shifts?.end_utc,
          location_id: row.shifts?.location_id,
          is_published: row.shifts?.is_published,
        })),
      )

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
              .select("id,shifts:shifts (start_utc,end_utc,location_id,is_published)")
              .eq("user_id", userData.user.id)
              .neq("status", "dropped")
              .then(({ data: rows }) => {
                setAssignments(
                  (rows ?? []).map((row: any) => ({
                    id: row.id,
                    start_utc: row.shifts?.start_utc,
                    end_utc: row.shifts?.end_utc,
                    location_id: row.shifts?.location_id,
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
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={markAllRead}
          >
            Mark all read
          </button>
        </div>

        {actionStatus && (
          <div className="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {actionStatus}
          </div>
        )}

        {status ? (
          <p className="text-sm text-muted-foreground">{status}</p>
        ) : notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          <div className="space-y-3">
            {notifications.map((item) => (
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
                  <span>{new Date(item.created_at).toLocaleString()}</span>
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
        <h2 className="text-lg font-semibold">Upcoming Assignments</h2>
        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming assignments.</p>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="rounded-md border border-border bg-muted/20 p-3">
                <div className="font-medium">Assignment {assignment.id}</div>
                <div className="text-muted-foreground">
                  {assignment.start_utc} → {assignment.end_utc}
                </div>
                <div className="text-xs text-muted-foreground">
                  Location: {assignment.location_id} · {assignment.is_published ? "Published" : "Unpublished"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
