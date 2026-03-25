export function formatAssignmentError(error: string | undefined, fallback: string) {
  switch (error) {
    case "headcount_full":
      return "Headcount is full for this shift. Choose another shift or adjust headcount."
    case "conflict":
      return "Another manager just updated assignments for this shift or staff member. Please retry."
    case "overlap":
      return "Staff member is already assigned to an overlapping shift."
    case "validation_failed":
      return "Assignment blocked by validation rules."
    case "shift_not_found":
      return "Shift not found."
    case "unauthenticated":
      return "Sign in required to assign staff."
    default:
      return fallback
  }
}

export function formatStaffSwapError(error: string | undefined, fallback: string) {
  switch (error) {
    case "swap_limit_reached":
      return "You already have 3 pending swap requests."
    case "assignment_not_found":
      return "That assignment is no longer available."
    case "assignment_not_owned":
      return "You can only swap your own active assignment."
    case "validation_failed":
      return "The target staff member is not eligible for this shift."
    case "invalid_transition":
      return "That swap action is no longer valid."
    case "conflict":
    case "assignment_conflict":
      return "This swap was just handled by someone else. Refresh to see the latest status."
    case "forbidden":
      return "You do not have permission to perform this action."
    case "missing_assignment":
      return "Please select a valid assignment."
    case "missing_target_user":
      return "Select a target staff member."
    default:
      return fallback
  }
}

export function formatStaffDropError(error: string | undefined, fallback: string) {
  switch (error) {
    case "drop_limit_reached":
      return "You already have 3 pending drop requests."
    case "assignment_not_found":
      return "That assignment is no longer available."
    case "assignment_not_owned":
      return "You can only drop your own active assignment."
    case "validation_failed":
      return "You are not eligible to claim this drop."
    case "invalid_transition":
      return "That drop action is no longer valid."
    case "conflict":
    case "assignment_conflict":
      return "This drop was just handled by someone else. Refresh to see the latest status."
    case "missing_claimed_by":
      return "This drop must be claimed before approval."
    case "missing_assignment":
      return "Please select a valid assignment."
    default:
      return fallback
  }
}

export function formatManagerSwapError(error: string | undefined, fallback: string) {
  switch (error) {
    case "invalid_transition":
      return "That swap action is no longer valid."
    case "conflict":
    case "assignment_conflict":
      return "This swap was just handled by someone else. Refresh to see the latest status."
    case "forbidden":
      return "You are not authorized to approve swaps for this location."
    case "swap_not_found":
      return "Swap request not found."
    default:
      return fallback
  }
}

export function formatManagerDropError(error: string | undefined, fallback: string) {
  switch (error) {
    case "invalid_transition":
      return "That drop action is no longer valid."
    case "conflict":
    case "assignment_conflict":
      return "This drop was just handled by someone else. Refresh to see the latest status."
    case "forbidden":
      return "You are not authorized to approve drops for this location."
    case "drop_not_found":
      return "Drop request not found."
    case "missing_claimed_by":
      return "Drop must be claimed before approval."
    default:
      return fallback
  }
}
