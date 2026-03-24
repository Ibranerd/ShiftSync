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

const now = new Date()
const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

function addDaysUtc(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function isoAtUtc(date: Date, hour: number) {
  const next = new Date(date)
  next.setUTCHours(hour, 0, 0, 0)
  return next.toISOString()
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function startOfWeekUtc(date: Date) {
  const day = date.getUTCDay() || 7
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (day - 1)))
}

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

  const { data: existingLocations, error: existingLocationsError } = await supabase
    .from("locations")
    .select("id,name,timezone")
    .in("name", locations.map((location) => location.name))
  if (existingLocationsError) {
    throw new Error(`Failed to fetch existing locations: ${existingLocationsError.message}`)
  }

  const locationByName = new Map<string, { id: string; name: string; timezone: string }>(
    (existingLocations ?? []).map((location) => [location.name, location]),
  )

  const missingLocations = locations.filter((location) => !locationByName.has(location.name))
  if (missingLocations.length > 0) {
    const { data: insertedLocations, error: insertLocationsError } = await supabase
      .from("locations")
      .insert(missingLocations)
      .select("id,name,timezone")
    if (insertLocationsError || !insertedLocations) {
      throw new Error(`Failed to insert locations: ${insertLocationsError?.message}`)
    }
    insertedLocations.forEach((location) => locationByName.set(location.name, location))
  }

  const locationRows = locations.map((location) => {
    const resolved = locationByName.get(location.name)
    if (!resolved) {
      throw new Error(`Failed to resolve location: ${location.name}`)
    }
    return resolved
  })

  const { data: existingSkills, error: existingSkillsError } = await supabase
    .from("skills")
    .select("id,name")
    .in("name", skills)
  if (existingSkillsError) {
    throw new Error(`Failed to fetch existing skills: ${existingSkillsError.message}`)
  }

  const skillByName = new Map<string, { id: string; name: string }>(
    (existingSkills ?? []).map((skill) => [skill.name, skill]),
  )

  const missingSkills = skills.filter((name) => !skillByName.has(name)).map((name) => ({ name }))
  if (missingSkills.length > 0) {
    const { data: insertedSkills, error: insertSkillsError } = await supabase
      .from("skills")
      .insert(missingSkills)
      .select("id,name")
    if (insertSkillsError || !insertedSkills) {
      throw new Error(`Failed to insert skills: ${insertSkillsError?.message}`)
    }
    insertedSkills.forEach((skill) => skillByName.set(skill.name, skill))
  }

  const skillRows = skills.map((name) => {
    const skill = skillByName.get(name)
    if (!skill) {
      throw new Error(`Failed to resolve skill: ${name}`)
    }
    return skill
  })

  const [nycLocation] = locationRows
  const [brooklynLocation] = locationRows.slice(1, 2)
  const laLocations = locationRows.slice(2)

  // Managers manage NY and LA locations
  await supabase.from("location_managers").upsert(
    [
    { user_id: managerIds[0], location_id: nycLocation.id },
    { user_id: managerIds[0], location_id: brooklynLocation.id },
    { user_id: managerIds[1], location_id: laLocations[0].id },
    { user_id: managerIds[1], location_id: laLocations[1].id },
    ],
    { onConflict: "user_id,location_id" },
  )

  // Staff certifications
  const certifications = staffIds.flatMap((userId, idx) => {
    const primary = idx % 2 === 0 ? nycLocation : laLocations[0]
    const secondary = idx % 3 === 0 ? brooklynLocation : laLocations[1]
    return [
      { user_id: userId, location_id: primary.id, certified_at: addDaysUtc(todayUtc, -30).toISOString() },
      { user_id: userId, location_id: secondary.id, certified_at: addDaysUtc(todayUtc, -15).toISOString() },
    ]
  })
  const { data: existingCerts, error: existingCertsError } = await supabase
    .from("user_locations")
    .select("user_id,location_id")
    .in("user_id", staffIds)
    .in("location_id", [nycLocation.id, brooklynLocation.id, laLocations[0].id, laLocations[1].id])
  if (existingCertsError) {
    throw new Error(`Failed to fetch existing certifications: ${existingCertsError.message}`)
  }

  const certKey = (row: { user_id: string; location_id: string }) => `${row.user_id}:${row.location_id}`
  const existingCertKeys = new Set((existingCerts ?? []).map(certKey))
  const missingCerts = certifications.filter(
    (cert) => !existingCertKeys.has(certKey(cert)),
  )
  if (missingCerts.length > 0) {
    await supabase.from("user_locations").insert(missingCerts)
  }

  // Staff skills
  const skillAssignments = staffIds.flatMap((userId, idx) => {
    const primary = skillRows[idx % skillRows.length]
    const secondary = skillRows[(idx + 1) % skillRows.length]
    return [
      { user_id: userId, skill_id: primary.id },
      { user_id: userId, skill_id: secondary.id },
    ]
  })
  await supabase.from("user_skills").upsert(skillAssignments, { onConflict: "user_id,skill_id" })

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
      exception_date: dateKey(addDaysUtc(todayUtc, 2)),
      start_local_time: "12:00:00",
      end_local_time: "14:00:00",
      is_unavailable: true,
    },
  ])
  const { data: existingAvailability, error: existingAvailabilityError } = await supabase
    .from("availability_windows")
    .select("user_id,day_of_week,exception_date,start_local_time,end_local_time,is_unavailable")
    .in("user_id", staffIds)
  if (existingAvailabilityError) {
    throw new Error(`Failed to fetch existing availability: ${existingAvailabilityError.message}`)
  }

  const availabilityKey = (row: {
    user_id: string
    day_of_week: number | null
    exception_date: string | null
    start_local_time: string
    end_local_time: string
    is_unavailable: boolean
  }) =>
    [
      row.user_id,
      row.day_of_week ?? "null",
      row.exception_date ?? "null",
      row.start_local_time,
      row.end_local_time,
      row.is_unavailable ? "1" : "0",
    ].join(":")

  const existingAvailabilityKeys = new Set(
    (existingAvailability ?? []).map(availabilityKey),
  )
  const missingAvailability = availability.filter(
    (entry) => !existingAvailabilityKeys.has(availabilityKey(entry)),
  )
  if (missingAvailability.length > 0) {
    await supabase.from("availability_windows").insert(missingAvailability)
  }

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
  await supabase
    .from("notification_preferences")
    .upsert(preferences, { onConflict: "user_id" })

  // Shifts with conflict case
  const onDutyStart = new Date(now.getTime() - 60 * 60 * 1000)
  const onDutyEnd = new Date(now.getTime() + 5 * 60 * 60 * 1000)
  const shiftRows = [
    {
      location_id: nycLocation.id,
      start_utc: onDutyStart.toISOString(),
      end_utc: onDutyEnd.toISOString(),
      required_skill_ids: [skillRows[0].id],
      is_premium: true,
      headcount_needed: 2,
      is_published: true,
    },
    {
      location_id: nycLocation.id,
      start_utc: isoAtUtc(addDaysUtc(todayUtc, 1), 14),
      end_utc: isoAtUtc(addDaysUtc(todayUtc, 1), 22),
      required_skill_ids: [skillRows[1].id],
      is_premium: false,
      headcount_needed: 1,
      is_published: false,
    },
    {
      location_id: laLocations[0].id,
      start_utc: isoAtUtc(addDaysUtc(todayUtc, 2), 14),
      end_utc: isoAtUtc(addDaysUtc(todayUtc, 2), 22),
      required_skill_ids: [skillRows[2].id],
      is_premium: true,
      headcount_needed: 3,
      is_published: true,
    },
  ]

  // Additional shifts for overtime + fairness imbalance
  const overtimeShiftRows = Array.from({ length: 5 }, (_, idx) => ({
    location_id: nycLocation.id,
    start_utc: isoAtUtc(addDaysUtc(todayUtc, idx + 3), 12),
    end_utc: isoAtUtc(addDaysUtc(todayUtc, idx + 3), 20),
    required_skill_ids: [skillRows[0].id],
    is_premium: true,
    headcount_needed: 1,
    is_published: true,
  }))

  const allSeedShifts = [...shiftRows, ...overtimeShiftRows]
  const shiftTimes = allSeedShifts.map((shift) => ({
    start: shift.start_utc,
    end: shift.end_utc,
  }))
  const minShiftStart = shiftTimes.reduce((min, curr) => (curr.start < min ? curr.start : min), shiftTimes[0].start)
  const maxShiftEnd = shiftTimes.reduce((max, curr) => (curr.end > max ? curr.end : max), shiftTimes[0].end)

  const { data: existingShifts, error: existingShiftsError } = await supabase
    .from("shifts")
    .select("id,location_id,start_utc,end_utc")
    .in("location_id", [nycLocation.id, brooklynLocation.id, ...laLocations.map((loc) => loc.id)])
    .gte("start_utc", minShiftStart)
    .lte("end_utc", maxShiftEnd)
  if (existingShiftsError) {
    throw new Error(`Failed to fetch existing shifts: ${existingShiftsError.message}`)
  }

  const shiftKey = (row: { location_id: string; start_utc: string; end_utc: string }) =>
    `${row.location_id}:${row.start_utc}:${row.end_utc}`

  const shiftByKey = new Map<string, { id: string; location_id: string; start_utc: string; end_utc: string }>(
    (existingShifts ?? []).map((shift) => [shiftKey(shift), shift]),
  )

  const missingShifts = shiftRows.filter((shift) => !shiftByKey.has(shiftKey(shift)))
  if (missingShifts.length > 0) {
    const { data: insertedShifts, error: insertShiftError } = await supabase
      .from("shifts")
      .insert(missingShifts)
      .select("id,location_id,start_utc,end_utc")
    if (insertShiftError || !insertedShifts) {
      throw new Error(`Failed to insert shifts: ${insertShiftError?.message}`)
    }
    insertedShifts.forEach((shift) => shiftByKey.set(shiftKey(shift), shift))
  }

  const createdShifts = shiftRows.map((shift) => {
    const resolved = shiftByKey.get(shiftKey(shift))
    if (!resolved) {
      throw new Error(`Failed to resolve shift for ${shift.location_id}`)
    }
    return resolved
  })

  // Assignments: conflict case + overtime edge + fairness imbalance
  const baseAssignments = [
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
  ]

  const { data: existingAssignments, error: existingAssignmentsError } = await supabase
    .from("shift_assignments")
    .select("shift_id,user_id")
    .in("shift_id", createdShifts.map((shift) => shift.id))
    .in("user_id", staffIds)
  if (existingAssignmentsError) {
    throw new Error(`Failed to fetch existing assignments: ${existingAssignmentsError.message}`)
  }

  const assignmentKey = (row: { shift_id: string; user_id: string }) =>
    `${row.shift_id}:${row.user_id}`
  const existingAssignmentKeys = new Set(
    (existingAssignments ?? []).map(assignmentKey),
  )
  const missingAssignments = baseAssignments.filter(
    (assignment) => !existingAssignmentKeys.has(assignmentKey(assignment)),
  )
  if (missingAssignments.length > 0) {
    await supabase.from("shift_assignments").insert(missingAssignments)
  }

  const missingOvertimeShifts = overtimeShiftRows.filter(
    (shift) => !shiftByKey.has(shiftKey(shift)),
  )
  const overtimeInsertResult =
    missingOvertimeShifts.length > 0
      ? await supabase
          .from("shifts")
          .insert(missingOvertimeShifts)
          .select("id,location_id,start_utc,end_utc")
      : null

  if (overtimeInsertResult?.error) {
    throw new Error(`Failed to insert overtime shifts: ${overtimeInsertResult.error.message}`)
  }

  if (overtimeInsertResult?.data) {
    overtimeInsertResult.data.forEach((shift) => shiftByKey.set(shiftKey(shift), shift))
  }

  const resolvedOvertimeShifts = overtimeShiftRows
    .map((shift) => shiftByKey.get(shiftKey(shift)) ?? null)
    .filter(
      (shift): shift is { id: string; location_id: string; start_utc: string; end_utc: string } =>
        Boolean(shift),
    )

  const overtimeAssignmentRows = resolvedOvertimeShifts.map((shift) => ({
    shift_id: shift.id,
    user_id: staffIds[2],
    assigned_by: managerIds[0],
    status: "assigned",
  }))

  if (overtimeAssignmentRows.length > 0) {
    const { data: existingOvertimeAssignments, error: existingOvertimeAssignmentsError } =
      await supabase
        .from("shift_assignments")
        .select("shift_id,user_id")
        .in("shift_id", overtimeAssignmentRows.map((row) => row.shift_id))
        .eq("user_id", staffIds[2])
    if (existingOvertimeAssignmentsError) {
      throw new Error(`Failed to fetch overtime assignments: ${existingOvertimeAssignmentsError.message}`)
    }

    const existingOvertimeKeys = new Set(
      (existingOvertimeAssignments ?? []).map(assignmentKey),
    )
    const missingOvertimeAssignments = overtimeAssignmentRows.filter(
      (assignment) => !existingOvertimeKeys.has(assignmentKey(assignment)),
    )
    if (missingOvertimeAssignments.length > 0) {
      await supabase.from("shift_assignments").insert(missingOvertimeAssignments)
    }
  }

  // Pending swap request
  const { data: existingSwapRequests, error: existingSwapRequestsError } = await supabase
    .from("swap_requests")
    .select("id")
    .eq("shift_id", createdShifts[0].id)
    .eq("requested_by", staffIds[0])
  if (existingSwapRequestsError) {
    throw new Error(`Failed to fetch swap requests: ${existingSwapRequestsError.message}`)
  }
  if (!existingSwapRequests || existingSwapRequests.length === 0) {
    await supabase.from("swap_requests").insert({
      shift_id: createdShifts[0].id,
      requested_by: staffIds[0],
      target_user_id: staffIds[3],
      status: "pending_manager",
      reason: "Need to swap due to appointment.",
    })
  }

  // Pending drop request
  const { data: existingDropRequests, error: existingDropRequestsError } = await supabase
    .from("drop_requests")
    .select("id")
    .eq("shift_id", createdShifts[1].id)
    .eq("requested_by", staffIds[1])
  if (existingDropRequestsError) {
    throw new Error(`Failed to fetch drop requests: ${existingDropRequestsError.message}`)
  }
  if (!existingDropRequests || existingDropRequests.length === 0) {
    await supabase.from("drop_requests").insert({
      shift_id: createdShifts[1].id,
      requested_by: staffIds[1],
      status: "pending",
      reason: "Offering this shift for drop.",
    })
  }

  // Overtime warning record for edge case
  const weekStartUtc = startOfWeekUtc(todayUtc).toISOString()
  const { data: existingWarnings, error: existingWarningsError } = await supabase
    .from("overtime_warnings")
    .select("id")
    .eq("user_id", staffIds[2])
    .eq("week_start_utc", weekStartUtc)
  if (existingWarningsError) {
    throw new Error(`Failed to fetch overtime warnings: ${existingWarningsError.message}`)
  }
  if (!existingWarnings || existingWarnings.length === 0) {
    await supabase.from("overtime_warnings").insert({
      user_id: staffIds[2],
      week_start_utc: weekStartUtc,
      total_hours: 40,
    })
  }

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
