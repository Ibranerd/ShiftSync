import SideDrawerLayout from "@/components/side-drawer-layout"

const navLinks = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/audit-logs", label: "Audit Logs" },
  { href: "/admin/fairness", label: "Fairness" },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SideDrawerLayout brand="ShiftSync Admin" title="Control Center" navLinks={navLinks} contentWidthClass="max-w-7xl">
      {children}
    </SideDrawerLayout>
  )
}
