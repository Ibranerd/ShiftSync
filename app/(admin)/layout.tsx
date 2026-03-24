import SideDrawerLayout from "@/components/side-drawer-layout"

const navLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/audit-logs", label: "Audit Logs" },
  { href: "/fairness", label: "Fairness" },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SideDrawerLayout brand="ShiftSync Admin" title="Control Center" navLinks={navLinks} contentWidthClass="max-w-7xl">
      {children}
    </SideDrawerLayout>
  )
}
