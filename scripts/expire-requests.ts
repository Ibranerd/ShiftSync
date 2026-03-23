import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

async function run() {
  const swapResult = await supabase.rpc("expire_swap_requests")
  const dropResult = await supabase.rpc("expire_drop_requests")

  console.log({
    swaps: swapResult.error?.message ?? "ok",
    drops: dropResult.error?.message ?? "ok",
  })
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
