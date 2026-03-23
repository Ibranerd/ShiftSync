import type { Role } from "@/types"

export function getUserRole(user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> } | null): Role | null {
  if (!user) return null
  const appRole = user.app_metadata?.role
  const userRole = user.user_metadata?.role
  if (typeof appRole === "string") return appRole as Role
  if (typeof userRole === "string") return userRole as Role
  return null
}
