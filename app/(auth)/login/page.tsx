"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { getUserRole } from "@/lib/supabase/auth"

type Status = "idle" | "loading" | "error" | "success"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [message, setMessage] = useState("")

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus("loading")
    setMessage("")

    try {
      const supabase = createSupabaseBrowserClient()
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error || !data.user) {
        setStatus("error")
        setMessage(error?.message ?? "Unable to sign in.")
        return
      }

      const role = getUserRole(data.user)
      if (role === "admin") {
        router.push("/admin/dashboard")
      } else if (role === "manager") {
        router.push("/manager/schedule")
      } else {
        router.push("/staff/my-shifts")
      }

      setStatus("success")
    } catch (err) {
      setStatus("error")
      setMessage(err instanceof Error ? err.message : "Unexpected error.")
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-6 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-8 shadow-sm">
        <div className="mb-6 space-y-2">
          <h1 className="text-2xl font-semibold">ShiftSync Login</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to manage schedules, swaps, and staffing across locations.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSignIn}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              placeholder="manager@shiftsync.dev"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90"
            disabled={status === "loading"}
          >
            {status === "loading" ? "Signing in..." : "Sign in"}
          </button>

          {status === "error" && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {message}
            </div>
          )}

          {status === "success" && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Signed in. Redirecting...
            </div>
          )}
        </form>
      </div>
    </main>
  )
}
