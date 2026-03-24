"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

type NavLink = {
  href: string
  label: string
}

type SideDrawerLayoutProps = {
  brand: string
  title: string
  navLinks: NavLink[]
  contentWidthClass?: string
  children: React.ReactNode
}

export default function SideDrawerLayout({
  brand,
  title,
  navLinks,
  contentWidthClass = "max-w-6xl",
  children,
}: SideDrawerLayoutProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const isActive = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(href))

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="flex">
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-border bg-background px-4 py-6 transition-transform duration-200 md:static md:translate-x-0 ${
            open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
          }`}
        >
          <div className="mb-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{brand}</p>
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
          <nav className="flex flex-col gap-2 text-sm font-medium">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`rounded-md px-3 py-2 ${
                  isActive(link.href) ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/logout"
              onClick={() => setOpen(false)}
              className="mt-4 rounded-md border border-border px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              Log out
            </Link>
          </nav>
        </aside>

        {open && (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setOpen(false)}
          />
        )}

        <div className="flex-1 md:ml-64">
          <header className="border-b border-border bg-background px-6 py-4 md:hidden">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{brand}</p>
                <h1 className="text-lg font-semibold">{title}</h1>
              </div>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground"
                onClick={() => setOpen(true)}
              >
                Menu
              </button>
            </div>
          </header>
          <div className={`mx-auto ${contentWidthClass} px-6 py-8`}>{children}</div>
        </div>
      </div>
    </div>
  )
}
