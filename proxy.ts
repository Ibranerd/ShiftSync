import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

const ADMIN_PREFIX = "/admin"
const MANAGER_PREFIX = "/manager"
const STAFF_PREFIX = "/staff"
const AUTH_PREFIX = "/login"
const LOGOUT_PATH = "/logout"

function extractRole(user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> } | null) {
  if (!user) return null
  const appRole = user.app_metadata?.role
  const userRole = user.user_metadata?.role
  if (typeof appRole === "string") return appRole
  if (typeof userRole === "string") return userRole
  return null
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next()
  }

  if (pathname.startsWith(AUTH_PREFIX) || pathname === LOGOUT_PATH) {
    return NextResponse.next()
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    return NextResponse.next()
  }

  const response = NextResponse.next()
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      get(name) {
        return request.cookies.get(name)?.value
      },
      set(name, value, options) {
        response.cookies.set({ name, value, ...options })
      },
      remove(name, options) {
        response.cookies.set({ name, value: "", ...options })
      },
    },
  })

  const { data } = await supabase.auth.getUser()
  const role = extractRole(data.user)

  if (!data.user) {
    const redirectUrl = new URL("/login", request.url)
    return NextResponse.redirect(redirectUrl)
  }

  if (pathname.startsWith(ADMIN_PREFIX) && role !== "admin") {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  if (pathname.startsWith(MANAGER_PREFIX) && role !== "manager" && role !== "admin") {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  if (pathname.startsWith(STAFF_PREFIX) && role !== "staff" && role !== "manager" && role !== "admin") {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
