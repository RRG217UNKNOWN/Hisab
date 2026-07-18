import type { Role } from "@/hooks/use-profile";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  accountant: "Accountant",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full access, including team and settings.",
  manager: "Inventory, sales and reports for assigned shops.",
  staff: "Inventory and sales for assigned shops only.",
  accountant: "Read-only access to reports and financials.",
};

// Any role check accepts undefined (legacy no-org users) — treated as owner.
const r = (role: Role | null | undefined): Role => (role ?? "owner") as Role;

export const can = {
  writeInventory: (role?: Role | null) => ["owner", "manager", "staff"].includes(r(role)),
  writeExpenses: (role?: Role | null) => ["owner", "manager"].includes(r(role)),
  writeWarehouses: (role?: Role | null) => r(role) === "owner",
  viewReports: (role?: Role | null) => r(role) !== "staff",
  viewCostPrice: (role?: Role | null) => r(role) !== "staff",
  manageTeam: (role?: Role | null) => r(role) === "owner",
  viewTeam: (role?: Role | null) => ["owner", "manager"].includes(r(role)),
  viewActivity: (role?: Role | null) => ["owner", "accountant"].includes(r(role)),
  alterEntries: (role?: Role | null) => ["owner", "manager"].includes(r(role)),
  viewVendors: (role?: Role | null) => r(role) !== "accountant",
  viewInventory: (role?: Role | null) => r(role) !== "accountant",
  viewSettings: () => true,
  viewExpenses: (role?: Role | null) => r(role) !== "staff",
  viewImport: (role?: Role | null) => ["owner", "manager", "staff"].includes(r(role)),
  viewExport: (role?: Role | null) => r(role) !== "staff",
  viewCreateBill: (role?: Role | null) => ["owner", "manager", "staff"].includes(r(role)),
  viewParties: (role?: Role | null) => r(role) !== "accountant" || true, // accountants can view
  manageParties: (role?: Role | null) => ["owner", "manager", "accountant"].includes(r(role)),
  manageConnections: (role?: Role | null) => r(role) === "owner",
  manageRequests: (role?: Role | null) => r(role) === "owner",
  fulfillRequests: (role?: Role | null) => ["owner", "manager"].includes(r(role)),
};
