import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

async function run() {
  const shiftId = process.env.TEST_SHIFT_ID
  const userId = process.env.TEST_USER_ID
  const managerId = process.env.TEST_MANAGER_ID

  if (!shiftId || !userId || !managerId) {
    throw new Error("Missing TEST_SHIFT_ID, TEST_USER_ID, or TEST_MANAGER_ID.")
  }

  const attempts = Array.from({ length: 3 }, () =>
    supabase.rpc("assign_staff_to_shift", {
      p_shift_id: shiftId,
      p_user_id: userId,
      p_assigned_by: managerId,
    }),
  )

  const results = await Promise.all(attempts)
  console.log(
    results.map((result, idx) => ({
      attempt: idx + 1,
      data: result.data,
      error: result.error?.message,
    })),
  )
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
