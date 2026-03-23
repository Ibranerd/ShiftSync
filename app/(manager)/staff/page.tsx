"use client"

import { useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

export default function ManagerStaffPage() {
  const [inApp, setInApp] = useState(true)
  const [emailSim, setEmailSim] = useState(false)
  const [message, setMessage] = useState("")
  const [staff, setStaff] = useState<Array<{ id: string; full_name: string }>>([])
  const [staffStatus, setStaffStatus] = useState("Loading staff...")

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const load = async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) return
      const { data } = await supabase
        .from("notification_preferences")
        .select("in_app,email_simulation")
        .eq("user_id", userData.user.id)
        .single()
      if (data) {
        setInApp(data.in_app)
        setEmailSim(data.email_simulation)
      }

      const { data: staffRows, error: staffError } = await supabase
        .from("users")
        .select("id,full_name")
        .eq("role", "staff")
        .limit(20)

      if (staffError) {
        setStaffStatus("Unable to load staff.")
      } else {
        setStaff((staffRows ?? []) as any)
        setStaffStatus("")
      }
    }
    void load()
  }, [])

  const savePreferences = async () => {
    const supabase = createSupabaseBrowserClient()
    setMessage("")
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      setMessage("Please sign in to save preferences.")
      return
    }
    const { error } = await supabase.from("notification_preferences").upsert({
      user_id: userData.user.id,
      in_app: inApp,
      email_simulation: emailSim,
      updated_at: new Date().toISOString(),
    })
    if (error) {
      setMessage("Unable to save preferences.")
      return
    }
    setMessage("Preferences saved.")
  }

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Staff Management</h1>
        <p className="text-sm text-muted-foreground">
          Manage staff profiles, skills, certifications, and your own notifications.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">Notification Preferences</h2>
        <p className="text-sm text-muted-foreground">
          Choose how you receive swap approvals, overtime warnings, and availability changes.
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
          {message && <span className="text-sm text-muted-foreground">{message}</span>}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-5">
        <h2 className="text-lg font-semibold">Staff List</h2>
        {staffStatus ? (
          <p className="text-sm text-muted-foreground">{staffStatus}</p>
        ) : staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">No staff found.</p>
        ) : (
          <div className="mt-3 space-y-2 text-sm">
            {staff.map((member) => (
              <div key={member.id} className="rounded-md border border-border bg-muted/20 p-3">
                {member.full_name}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
