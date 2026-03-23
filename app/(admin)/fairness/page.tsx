export default function FairnessPage() {
  const data = [
    { name: "Staff 1", hours: 32, premium: 4, desired: 30 },
    { name: "Staff 2", hours: 18, premium: 0, desired: 24 },
    { name: "Staff 3", hours: 42, premium: 7, desired: 36 },
    { name: "Staff 4", hours: 26, premium: 1, desired: 24 },
    { name: "Staff 5", hours: 12, premium: 0, desired: 20 },
  ]

  return (
    <main className="flex min-h-[60vh] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Fairness Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Premium shift distribution by staff member.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-background p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">Timeframe</div>
            <div className="text-sm font-medium">Last 4 weeks</div>
          </div>
          <select className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option>Last 4 weeks</option>
            <option>Last 8 weeks</option>
            <option>Quarter to date</option>
          </select>
        </div>
        <div className="space-y-4">
          {data.map((row) => (
            <div key={row.name} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{row.name}</span>
                <span className="text-muted-foreground">
                  {row.hours} hrs · {row.premium} premium ·
                  {" "}
                  {row.hours - row.desired >= 0 ? "+" : ""}
                  {row.hours - row.desired} vs desired
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.min(100, (row.premium / 8) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
