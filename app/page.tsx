import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getUserRole } from "@/lib/supabase/auth"

export default async function Home() {
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
