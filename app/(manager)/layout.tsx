import Link from "next/link"

const navLinks = [
  { href: "/manager/schedule", label: "Schedule" },
  { href: "/manager/staff", label: "Staff" },
  { href: "/manager/swaps", label: "Swaps" },
]

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">ShiftSync Manager</p>
            <h1 className="text-lg font-semibold">Scheduling Suite</h1>
          </div>
          <nav className="flex items-center gap-4 text-sm font-medium">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className="text-muted-foreground hover:text-foreground">
                {link.label}
              </Link>
            ))}
            <Link href="/logout" className="rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-wide">
              Log out
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </div>
  )
}
