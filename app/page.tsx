import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getUserRole } from "@/lib/supabase/auth"

export default async function Home() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col gap-4 px-6 py-10">
        <h1 className="text-2xl font-semibold">ShiftSync</h1>
        <p className="text-sm text-muted-foreground">
          Missing Supabase environment variables. Add them to `.env.local` and rebuild.
        </p>
      </main>
    )
  }

  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) {
    redirect("/login")
  }

  const role = getUserRole(data.user)
  if (role === "admin") {
    redirect("/admin/dashboard")
  }
  if (role === "manager") {
    redirect("/manager/schedule")
  }
  redirect("/staff/my-shifts")
}
