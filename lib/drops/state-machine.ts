export type DropStatus =
  | "pending"
  | "claimed"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"

export type DropAction = "request" | "claim" | "approve" | "reject" | "cancel" | "expire"

const transitions: Record<DropStatus, Partial<Record<DropAction, DropStatus>>> = {
  pending: {
    claim: "claimed",
    cancel: "cancelled",
    expire: "expired",
  },
  claimed: {
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

export function canDropTransition(status: DropStatus, action: DropAction) {
  return Boolean(transitions[status]?.[action])
}

export function nextDropStatus(status: DropStatus, action: DropAction): DropStatus | null {
  return transitions[status]?.[action] ?? null
}
