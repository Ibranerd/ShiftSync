import SideDrawerLayout from "@/components/side-drawer-layout"

const navLinks = [
  { href: "/my-shifts", label: "My Shifts" },
  { href: "/availability", label: "Availability" },
  { href: "/swap-requests", label: "Swap Requests" },
]

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <SideDrawerLayout brand="ShiftSync Staff" title="Your Schedule" navLinks={navLinks}>
      {children}
    </SideDrawerLayout>
  )
}
