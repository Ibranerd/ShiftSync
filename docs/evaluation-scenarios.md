# Timezone and Scenario Validation

## Six Expected Evaluation Scenarios
1. Overlapping shifts are blocked (DOUBLE_BOOK).
2. Rest gap under 10 hours is blocked (REST_GAP).
3. Missing required skills are blocked (SKILL_MISMATCH).
4. Not certified for location is blocked (LOCATION_NOT_CERTIFIED).
5. Availability conflicts are blocked (AVAILABILITY_CONFLICT).
6. Daily hours exceed 12 hours is blocked (DAILY_HOURS_EXCEEDED).

## Timezone Walkthroughs

### Overnight Shifts
- Validate availability coverage across both calendar days in the shift's location timezone.
- Example: 10pm–4am local must be covered by Friday and Saturday windows.

### DST Behavior
- Use `date-fns-tz` conversions for local interpretation.
- Validate shifts on DST start/end dates with full-day availability windows.

### Dual-Location Staff Handling
- Staff certifications are evaluated against the shift location only.
- Availability is interpreted in the shift location’s timezone.
