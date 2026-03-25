export type SwapStatus =
  | "pending_staff"
  | "pending_manager"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"

export type SwapAction = "request" | "accept" | "reject" | "approve" | "cancel" | "expire"

const transitions: Record<SwapStatus, Partial<Record<SwapAction, SwapStatus>>> = {
  pending_staff: {
    request: "pending_staff",
    accept: "pending_manager",
    cancel: "cancelled",
    expire: "expired",
  },
  pending_manager: {
    approve: "approved",
    reject: "rejected",
    cancel: "cancelled",
    expire: "expired",
  },
  approved: {},
  rejected: {},
  cancelled: {},
  expired: {},
}

export function canTransition(status: SwapStatus, action: SwapAction) {
  return Boolean(transitions[status]?.[action])
}

export function nextStatus(status: SwapStatus, action: SwapAction): SwapStatus | null {
  return transitions[status]?.[action] ?? null
}
