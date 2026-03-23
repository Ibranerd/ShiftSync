import { NextResponse } from "next/server"
import { validateAssignment } from "@/lib/constraint-engine"

export async function GET() {
  return NextResponse.json({ ok: true, route: "assignments" })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 })
  }

  const {
    candidateUserId,
    targetShift,
    existingAssignments,
    userSkills,
    userLocations,
    availabilityWindows,
    staffCandidates,
    overrideReason,
  } = body

  if (!candidateUserId || !targetShift) {
    return NextResponse.json({ ok: false, error: "missing_candidate_or_shift" }, { status: 400 })
  }

  const result = await validateAssignment(
    candidateUserId,
    targetShift,
    existingAssignments ?? [],
    userSkills ?? [],
    userLocations ?? [],
    availabilityWindows ?? [],
    staffCandidates ?? [],
    overrideReason,
  )

  return NextResponse.json({ ok: true, result })
}
