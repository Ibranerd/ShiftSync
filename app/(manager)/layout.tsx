import SideDrawerLayout from "@/components/side-drawer-layout"

const navLinks = [
  { href: "/manager/dashboard", label: "Dashboard" },
  { href: "/manager/schedule", label: "Schedule" },
  { href: "/manager/staff", label: "Staff" },
  { href: "/manager/fairness", label: "Fairness" },
  { href: "/manager/swaps", label: "Swaps" },
]

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return (
    <SideDrawerLayout brand="ShiftSync Manager" title="Scheduling Suite" navLinks={navLinks}>
      {children}
    </SideDrawerLayout>
  )
}
