"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

export default function LogoutPage() {
  const router = useRouter()

  useEffect(() => {
    const signOut = async () => {
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.signOut()
      router.replace("/login")
    }

    void signOut()
  }, [router])

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <p className="text-sm text-muted-foreground">Signing you out...</p>
    </main>
  )
}
