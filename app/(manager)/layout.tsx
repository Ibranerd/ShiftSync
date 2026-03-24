import SideDrawerLayout from "@/components/side-drawer-layout"

const navLinks = [
  { href: "/schedule", label: "Schedule" },
  { href: "/staff", label: "Staff" },
  { href: "/fairness", label: "Fairness" },
  { href: "/swaps", label: "Swaps" },
]

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return (
    <SideDrawerLayout brand="ShiftSync Manager" title="Scheduling Suite" navLinks={navLinks}>
      {children}
    </SideDrawerLayout>
  )
}
