# Additional Test Coverage

1. Suggested alternatives: ensure `validateAssignment` returns `suggestions` for qualified candidates.
2. Drop request limit: ensure DB trigger blocks >3 pending drops.
3. Swap request limit: ensure DB trigger blocks >3 pending swaps.
4. Swap auto-cancel on shift edit: update a shift and confirm swap status becomes `cancelled`.
5. Drop auto-expire: confirm `expire_drop_requests()` moves eligible drops to `expired`.
6. Swap auto-expire: confirm `expire_swap_requests()` moves eligible swaps to `expired`.
7. Publish cutoff override: unpublish within 48 hours fails for manager but succeeds for admin with reason.
8. Availability exception blackout: exception window marked `is_unavailable` blocks even when recurring availability exists.
9. Notification triggers: insert swap/drop/overtime/availability update and verify notifications are created.
10. RLS location scope: manager cannot read shifts/users outside assigned locations.
