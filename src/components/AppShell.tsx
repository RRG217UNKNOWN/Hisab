import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Package,
  Users,
  BarChart3,
  Settings,
  UserCircle2,
  Menu,
  X,
  Loader2,
  UsersRound,
  Activity,
  ClipboardList,
  Receipt,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { can } from "@/lib/permissions";
import { useT } from "@/lib/i18n";

export type NavKey =
  | "dashboard"
  | "inventory"
  | "purchase-voucher"
  | "create-bill"
  | "vendors"
  | "reports"
  | "team"
  | "activity"
  | "account"
  | "settings";

export function AppShell({
  active,
  title,
  children,
  headerRight,
}: {
  active: NavKey;
  title: string;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, loading } = useAuth();
  const { profile } = useProfile();
  const { t } = useT();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  const role = profile?.role;

  const ALL_NAV: {
    key: NavKey;
    label: string;
    to: string;
    icon: React.ReactNode;
    show: boolean;
  }[] = [
    { key: "dashboard", label: t("nav.dashboard"), to: "/", icon: <LayoutDashboard size={17} />, show: true },
    { key: "inventory", label: t("nav.inventory"), to: "/inventory", icon: <Package size={17} />, show: can.viewInventory(role) },
    { key: "purchase-voucher", label: t("nav.purchaseVoucher"), to: "/purchase-voucher", icon: <ClipboardList size={17} />, show: can.writeInventory(role) },
    { key: "create-bill", label: t("nav.createBill"), to: "/create-bill", icon: <Receipt size={17} />, show: can.writeInventory(role) },
    { key: "vendors", label: t("nav.vendors"), to: "/vendors", icon: <Users size={17} />, show: can.viewVendors(role) },
    { key: "reports", label: t("nav.reports"), to: "/reports", icon: <BarChart3 size={17} />, show: can.viewReports(role) },
    { key: "team", label: t("nav.team"), to: "/team", icon: <UsersRound size={17} />, show: can.viewTeam(role) },
    { key: "activity", label: t("nav.activity"), to: "/activity", icon: <Activity size={17} />, show: can.viewActivity(role) },
    { key: "account", label: t("nav.account"), to: "/account", icon: <UserCircle2 size={17} />, show: true },
    { key: "settings", label: t("nav.settings"), to: "/settings", icon: <Settings size={17} />, show: true },
  ];
  const NAV = ALL_NAV.filter((n) => n.show);

  const nav = (
    <nav className="flex flex-col gap-1 text-sm">
      {NAV.map((item) => {
        const isActive = item.key === active;
        const className = `flex items-center gap-3 rounded-lg px-3 py-2.5 transition ${
          isActive
            ? "bg-primary/10 text-ink font-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`;
        return (
          <Link key={item.key} to={item.to} onClick={() => setMobileOpen(false)} className={className}>
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex">
        <aside className="hidden md:flex sticky top-0 h-screen w-60 flex-col border-r border-border bg-sand-50 px-5 py-7">
          <Link to="/" className="mb-10 block">
            <div className="font-display text-2xl leading-none text-ink">Hisab</div>
            <div className="mt-1 text-xs text-muted-foreground tracking-wide">
              हिसाब · your shop ledger
            </div>
          </Link>
          {nav}
          <div className="mt-auto pt-6 text-xs text-muted-foreground leading-relaxed">
            {profile?.org?.name ? `${profile.org.name}` : "Prototype · मुफ्त परीक्षण"}
          </div>
        </aside>

        {mobileOpen && (
          <div className="md:hidden fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-sand-50 border-r border-border px-5 py-6 flex flex-col">
              <div className="flex items-start justify-between mb-8">
                <Link to="/" onClick={() => setMobileOpen(false)}>
                  <div className="font-display text-2xl leading-none text-ink">Hisab</div>
                  <div className="mt-1 text-xs text-muted-foreground tracking-wide">
                    हिसाब · your shop ledger
                  </div>
                </Link>
                <button
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close menu"
                  className="h-9 w-9 grid place-items-center rounded-full hover:bg-muted"
                >
                  <X size={18} />
                </button>
              </div>
              {nav}
            </aside>
          </div>
        )}

        <main className="flex-1 min-w-0">
          <div className="md:hidden flex items-center gap-3 border-b border-border px-4 py-3 bg-background sticky top-0 z-30">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="h-9 w-9 grid place-items-center rounded-lg hover:bg-muted"
            >
              <Menu size={20} />
            </button>
            <div className="font-display text-lg text-ink truncate flex-1 min-w-0">
              {title}
            </div>
            {headerRight}
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}
