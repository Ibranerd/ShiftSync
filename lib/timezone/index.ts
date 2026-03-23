import { format, toZonedTime } from "date-fns-tz"

export function formatInTimezone(date: Date, timeZone: string, pattern = "yyyy-MM-dd HH:mm") {
  const zonedDate = toZonedTime(date, timeZone)
  return format(zonedDate, pattern, { timeZone })
}
