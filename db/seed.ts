import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in environment.",
  )
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

const skills = ["Barista", "Cashier", "Supervisor", "Chef"]

const locations = [
  { name: "Manhattan Cafe", timezone: "America/New_York" },
  { name: "Brooklyn Deli", timezone: "America/New_York" },
  { name: "Downtown LA", timezone: "America/Los_Angeles" },
  { name: "Santa Monica", timezone: "America/Los_Angeles" },
]

const managerEmails = ["manager1@shiftsync.dev", "manager2@shiftsync.dev"]
const staffEmails = Array.from({ length: 20 }, (_, i) => `staff${i + 1}@shiftsync.dev`)

async function ensureSchema() {
  const { error } = await supabase.from("users").select("id").limit(1)
  if (error && error.message?.includes("schema cache")) {
    throw new Error(
      "Database tables are missing. Run migrations first (supabase db push) before seeding.",
    )
  }
}

async function createUser(email: string, role: string, fullName: string, desiredWeeklyHours = 0) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: "Password123!",
    email_confirm: true,
    user_metadata: { role },
    app_metadata: { role },
  })
  if (error && error.message?.includes("already been registered")) {
    const { data: existing, error: fetchError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    })
    if (fetchError) {
      throw new Error(`Failed to find existing user ${email}: ${fetchError.message}`)
    }
    const existingUser = existing.users.find((user) => user.email === email)
    if (!existingUser) {
      throw new Error(`Failed to create user ${email}: ${error.message}`)
    }

    const { error: upsertError } = await supabase.from("users").upsert({
      id: existingUser.id,
      full_name: fullName,
      role,
      desired_weekly_hours: desiredWeeklyHours,
    })
    if (upsertError) {
      throw new Error(`Failed to upsert profile for ${email}: ${upsertError.message}`)
    }
    return existingUser.id
  }

  if (error || !data.user) {
    throw new Error(`Failed to create user ${email}: ${error?.message}`)
  }

  const { error: insertError } = await supabase.from("users").upsert({
    id: data.user.id,
    full_name: fullName,
    role,
    desired_weekly_hours: desiredWeeklyHours,
  })
  if (insertError) {
    throw new Error(`Failed to insert profile for ${email}: ${insertError.message}`)
  }

  return data.user.id
}

async function seed() {
  await ensureSchema()
  const adminId = await createUser("admin@shiftsync.dev", "admin", "Admin User")
  const managerIds = await Promise.all(
    managerEmails.map((email, idx) => createUser(email, "manager", `Manager ${idx + 1}`)),
  )
  const staffIds = await Promise.all(
    staffEmails.map((email, idx) =>
      createUser(email, "staff", `Staff ${idx + 1}`, 20 + (idx % 4) * 5),
    ),
  )

  const { data: locationRows, error: locationError } = await supabase
    .from("locations")
    .insert(locations)
    .select()
  if (locationError || !locationRows) {
    throw new Error(`Failed to insert locations: ${locationError?.message}`)
  }

  const { data: skillRows, error: skillError } = await supabase.from("skills").insert(
    skills.map((name) => ({ name })),
  ).select()
  if (skillError || !skillRows) {
    throw new Error(`Failed to insert skills: ${skillError?.message}`)
  }

  const [nycLocation] = locationRows
  const [brooklynLocation] = locationRows.slice(1, 2)
  const laLocations = locationRows.slice(2)

  // Managers manage NY and LA locations
  await supabase.from("location_managers").insert([
    { user_id: managerIds[0], location_id: nycLocation.id },
    { user_id: managerIds[0], location_id: brooklynLocation.id },
    { user_id: managerIds[1], location_id: laLocations[0].id },
    { user_id: managerIds[1], location_id: laLocations[1].id },
  ])

  // Staff certifications
  const certifications = staffIds.flatMap((userId, idx) => {
    const primary = idx % 2 === 0 ? nycLocation : laLocations[0]
    const secondary = idx % 3 === 0 ? brooklynLocation : laLocations[1]
    return [
      { user_id: userId, location_id: primary.id, certified_at: "2024-12-01T00:00:00.000Z" },
      { user_id: userId, location_id: secondary.id, certified_at: "2024-12-15T00:00:00.000Z" },
    ]
  })
  await supabase.from("user_locations").insert(certifications)

  // Staff skills
  const skillAssignments = staffIds.flatMap((userId, idx) => {
    const primary = skillRows[idx % skillRows.length]
    const secondary = skillRows[(idx + 1) % skillRows.length]
    return [
      { user_id: userId, skill_id: primary.id },
      { user_id: userId, skill_id: secondary.id },
    ]
  })
  await supabase.from("user_skills").insert(skillAssignments)

  // Availability windows with exception
  const availability = staffIds.flatMap((userId, idx) => [
    {
      user_id: userId,
      day_of_week: 1,
      start_local_time: "08:00:00",
      end_local_time: "16:00:00",
      is_unavailable: false,
    },
    {
      user_id: userId,
      day_of_week: 5,
      start_local_time: "10:00:00",
      end_local_time: "18:00:00",
      is_unavailable: false,
    },
    {
      user_id: userId,
      exception_date: "2025-01-10",
      start_local_time: "12:00:00",
      end_local_time: "14:00:00",
      is_unavailable: true,
    },
  ])
  await supabase.from("availability_windows").insert(availability)

  // Notification preferences
  const preferences = [
    { user_id: adminId, in_app: true, email_simulation: true },
    { user_id: managerIds[0], in_app: true, email_simulation: true },
    { user_id: managerIds[1], in_app: true, email_simulation: false },
    ...staffIds.map((userId, idx) => ({
      user_id: userId,
      in_app: true,
      email_simulation: idx % 2 === 0,
    })),
  ]
  await supabase.from("notification_preferences").insert(preferences)

  // Shifts with conflict case
  const shiftRows = [
    {
      location_id: nycLocation.id,
      start_utc: "2025-01-10T14:00:00.000Z",
      end_utc: "2025-01-10T22:00:00.000Z",
      required_skill_ids: [skillRows[0].id],
      is_premium: true,
      headcount_needed: 2,
      is_published: true,
    },
    {
      location_id: nycLocation.id,
      start_utc: "2025-01-10T18:00:00.000Z",
      end_utc: "2025-01-10T23:00:00.000Z",
      required_skill_ids: [skillRows[1].id],
      is_premium: false,
      headcount_needed: 1,
      is_published: false,
    },
    {
      location_id: laLocations[0].id,
      start_utc: "2025-01-11T14:00:00.000Z",
      end_utc: "2025-01-11T22:00:00.000Z",
      required_skill_ids: [skillRows[2].id],
      is_premium: true,
      headcount_needed: 3,
      is_published: true,
    },
  ]

  const { data: createdShifts, error: shiftError } = await supabase.from("shifts").insert(shiftRows).select()
  if (shiftError || !createdShifts) {
    throw new Error(`Failed to insert shifts: ${shiftError?.message}`)
  }

  // Assignments: conflict case + overtime edge + fairness imbalance
  await supabase.from("shift_assignments").insert([
    {
      shift_id: createdShifts[0].id,
      user_id: staffIds[0],
      assigned_by: managerIds[0],
      status: "assigned",
    },
    {
      shift_id: createdShifts[1].id,
      user_id: staffIds[0],
      assigned_by: managerIds[0],
      status: "assigned",
    },
    {
      shift_id: createdShifts[2].id,
      user_id: staffIds[1],
      assigned_by: managerIds[1],
      status: "confirmed",
    },
  ])

  // Additional shifts for overtime + fairness imbalance
  const overtimeShiftRows = Array.from({ length: 5 }, (_, idx) => ({
    location_id: nycLocation.id,
    start_utc: `2025-01-0${idx + 5}T12:00:00.000Z`,
    end_utc: `2025-01-0${idx + 5}T20:00:00.000Z`,
    required_skill_ids: [skillRows[0].id],
    is_premium: true,
    headcount_needed: 1,
    is_published: true,
  }))
  const { data: overtimeShifts } = await supabase.from("shifts").insert(overtimeShiftRows).select()
  if (overtimeShifts) {
    await supabase.from("shift_assignments").insert(
      overtimeShifts.map((shift) => ({
        shift_id: shift.id,
        user_id: staffIds[2],
        assigned_by: managerIds[0],
        status: "assigned",
      })),
    )
  }

  // Pending swap request
  await supabase.from("swap_requests").insert({
    shift_id: createdShifts[0].id,
    requested_by: staffIds[0],
    target_user_id: staffIds[3],
    status: "pending_manager",
    reason: "Need to swap due to appointment.",
  })

  // Pending drop request
  await supabase.from("drop_requests").insert({
    shift_id: createdShifts[1].id,
    requested_by: staffIds[1],
    status: "pending",
    reason: "Offering this shift for drop.",
  })

  // Overtime warning record for edge case
  await supabase.from("overtime_warnings").insert({
    user_id: staffIds[2],
    week_start_utc: "2025-01-06T00:00:00.000Z",
    total_hours: 40,
  })

  console.log("Seed completed", {
    adminId,
    managerIds,
    staffCount: staffIds.length,
  })
}

seed().catch((error) => {
  console.error(error)
  process.exit(1)
})
