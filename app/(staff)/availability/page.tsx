"use client"

import { useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

export default function StaffAvailabilityPage() {
  const [inApp, setInApp] = useState(true)
  const [emailSim, setEmailSim] = useState(false)
  const [prefMessage, setPrefMessage] = useState("")
  const [availMessage, setAvailMessage] = useState("")
  const [dayOfWeek, setDayOfWeek] = useState("1")
  const [startTime, setStartTime] = useState("08:00")
  const [endTime, setEndTime] = useState("16:00")
  const [availability, setAvailability] = useState<Array<{ id: string; day_of_week: number; start_local_time: string; end_local_time: string }>>([])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const load = async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) return
      const { data: availabilityRows } = await supabase
        .from("availability_windows")
        .select("id,day_of_week,start_local_time,end_local_time")
        .eq("user_id", userData.user.id)
        .is("exception_date", null)
        .order("day_of_week", { ascending: true })
      setAvailability((availabilityRows ?? []) as any)
      const { data } = await supabase
        .from("notification_preferences")
        .select("in_app,email_simulation")
        .eq("user_id", userData.user.id)
        .single()
      if (data) {
        setInApp(data.in_app)
        setEmailSim(data.email_simulation)
      }
    }
    void load()
  }, [])

  const addAvailability = async () => {
    const supabase = createSupabaseBrowserClient()
    setAvailMessage("")
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      setAvailMessage("Please sign in to save availability.")
      return
    }
    const { data, error } = await supabase
      .from("availability_windows")
      .insert({
        user_id: userData.user.id,
        day_of_week: Number(dayOfWeek),
        start_local_time: startTime,
        end_local_time: endTime,
        is_unavailable: false,
      })
      .select()
      .single()
    if (error) {
      setAvailMessage("Unable to save availability.")
      return
    }
    setAvailability((current) => [...current, data])
    setAvailMessage("Availability saved.")
  }

  const savePreferences = async () => {
    const supabase = createSupabaseBrowserClient()
    setPrefMessage("")
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      setPrefMessage("Please sign in to save preferences.")
      return
    }
    const { error } = await supabase.from("notification_preferences").upsert({
      user_id: userData.user.id,
      in_app: inApp,
      email_simulation: emailSim,
      updated_at: new Date().toISOString(),
    })
    if (error) {
      setPrefMessage("Unable to save preferences.")
      return
    }
    setPrefMessage("Preferences saved.")
  }

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Availability</h1>
        <p className="text-sm text-muted-foreground">
          Manage recurring availability, exceptions, and notification preferences.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">Availability Windows</h2>
        <p className="text-sm text-muted-foreground">
          Add recurring availability windows for weekly schedules.
        </p>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Day of week</label>
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={dayOfWeek}
              onChange={(event) => setDayOfWeek(event.target.value)}
            >
              <option value="1">Monday</option>
              <option value="2">Tuesday</option>
              <option value="3">Wednesday</option>
              <option value="4">Thursday</option>
              <option value="5">Friday</option>
              <option value="6">Saturday</option>
              <option value="0">Sunday</option>
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Start</label>
            <input
              type="time"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">End</label>
            <input
              type="time"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={addAvailability}
          >
            Add availability
          </button>
          {availMessage && <span className="text-sm text-muted-foreground">{availMessage}</span>}
        </div>
        <div className="mt-4 space-y-2 text-sm">
          {availability.map((item) => (
            <div key={item.id} className="rounded-md border border-border bg-muted/20 p-3">
              Day {item.day_of_week} · {item.start_local_time} - {item.end_local_time}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">Notification Preferences</h2>
        <p className="text-sm text-muted-foreground">
          Choose how you receive schedule and swap updates.
        </p>

        <div className="mt-4 space-y-3 text-sm">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={inApp}
              onChange={(event) => setInApp(event.target.checked)}
            />
            <span>In-app notifications</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={emailSim}
              onChange={(event) => setEmailSim(event.target.checked)}
            />
            <span>Email simulation</span>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            onClick={savePreferences}
          >
            Save preferences
          </button>
          {prefMessage && <span className="text-sm text-muted-foreground">{prefMessage}</span>}
        </div>
      </section>
    </main>
  )
}
