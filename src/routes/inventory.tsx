import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  Search,
  AlertTriangle,
  Clock,
  Plus,
  Package,
  X,
  Pencil,
  Trash2,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  MoreHorizontal,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/inventory")({
  component: InventoryPage,
  head: () => ({
    meta: [
      { title: "Inventory · Hisab" },
      {
        name: "description",
        content:
          "Track stock, expiry dates and low-stock alerts across your shops.",
      },
    ],
  }),
});

type Item = {
  id: string;
  name: string;
  category: string;
  stock: number;
  min_stock: number;
  price: number;
  cost_price: number;
  expiry: string | null;
  warehouse_id: string;
};

type Warehouse = { id: string; name: string; address: string | null };

type Filter = "all" | "low" | "expiring";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

const itemSchema = z.object({
  name: z.string().trim().min(1, "Name required").max(120),
  category: z.string().trim().max(60).optional().or(z.literal("")),
  stock: z.number().int().min(0).max(1_000_000),
  min_stock: z.number().int().min(0).max(1_000_000),
  price: z.number().min(0).max(10_000_000),
  cost_price: z.number().min(0).max(10_000_000),
  expiry: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .or(z.literal("")),
  warehouse_id: z.string().uuid("Pick a shop"),
});

function InventoryPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { t } = useT();
  const showCostPrice = can.viewCostPrice(profile?.role);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [activeShop, setActiveShop] = useState<string>("all");
  const [dbLoading, setDbLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [showAddShop, setShowAddShop] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [saleItem, setSaleItem] = useState<Item | null>(null);
  const [adjustItem, setAdjustItem] = useState<Item | null>(null);
  const [shopMenuFor, setShopMenuFor] = useState<string | null>(null);
  const [renameShop, setRenameShop] = useState<Warehouse | null>(null);

  const loadAll = useCallback(async () => {
    if (!user) return;
    setDbLoading(true);
    setError(null);
    const [wh, it] = await Promise.all([
      supabase.from("warehouses").select("id, name, address").order("created_at"),
      supabase
        .from("inventory_items")
        .select("id, name, category, stock, min_stock, price, cost_price, expiry, warehouse_id")
        .order("created_at", { ascending: false }),
    ]);
    if (wh.error) setError(wh.error.message);
    if (it.error) setError(it.error.message);

    let list = wh.data ?? [];
    // Auto-create default shop if none
    if (list.length === 0) {
      const { data: created, error: cErr } = await supabase
        .from("warehouses")
        .insert({ user_id: user.id, name: "Main Shop" })
        .select("id, name, address")
        .single();
      if (cErr) setError(cErr.message);
      else if (created) list = [created];
    }
    setWarehouses(list);

    setItems(
      (it.data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category ?? "",
        stock: r.stock,
        min_stock: r.min_stock,
        price: Number(r.price),
        cost_price: Number(r.cost_price ?? 0),
        expiry: r.expiry,
        warehouse_id: r.warehouse_id,
      })),
    );
    setDbLoading(false);
  }, [user]);

  useEffect(() => {
    if (user) void loadAll();
  }, [user, loadAll]);

  const visibleItems = useMemo(
    () => (activeShop === "all" ? items : items.filter((i) => i.warehouse_id === activeShop)),
    [items, activeShop],
  );

  const filtered = useMemo(() => {
    return visibleItems.filter((it) => {
      if (query && !it.name.toLowerCase().includes(query.toLowerCase())) return false;
      if (filter === "low" && it.stock > it.min_stock) return false;
      if (filter === "expiring") {
        if (!it.expiry) return false;
        const d = daysUntil(it.expiry);
        if (d > 30 || d < 0) return false;
      }
      return true;
    });
  }, [visibleItems, query, filter]);

  const lowCount = visibleItems.filter((i) => i.stock <= i.min_stock).length;
  const expiringCount = visibleItems.filter(
    (i) => i.expiry && daysUntil(i.expiry) >= 0 && daysUntil(i.expiry) <= 30,
  ).length;
  const totalValue = visibleItems.reduce((s, i) => s + i.stock * i.price, 0);

  const shopName = (id: string) =>
    warehouses.find((w) => w.id === id)?.name ?? "—";

  const defaultShopForNew =
    activeShop !== "all" ? activeShop : warehouses[0]?.id ?? "";

  const removeShop = async (w: Warehouse) => {
    const hasItems = items.some((i) => i.warehouse_id === w.id);
    if (hasItems) {
      alert(t("inv.shopHasItems"));
      return;
    }
    if (!confirm(t("inv.confirmShopDelete"))) return;
    const { error } = await supabase.from("warehouses").delete().eq("id", w.id);
    if (error) return alert(error.message);
    if (activeShop === w.id) setActiveShop("all");
    void loadAll();
  };

  return (
    <AppShell active="inventory" title={t("inv.title")}>
      <div className="px-4 md:px-10 py-6 md:py-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {t("inv.stockLedger")}
            </p>
            <h1 className="mt-1 font-display text-3xl md:text-4xl text-ink">
              {t("inv.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {visibleItems.length} · {inr(totalValue)}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            disabled={warehouses.length === 0}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-60"
          >
            <Plus size={14} /> {t("inv.addItem")}
          </button>
        </header>

        {error && (
          <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">
            {error}
          </div>
        )}

        {/* Shop switcher */}
        <section className="card-warm p-3 md:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Store size={16} className="text-muted-foreground ml-1" />
            <ShopTab
              label={t("common.allShops")}
              active={activeShop === "all"}
              onClick={() => setActiveShop("all")}
            />
            {warehouses.map((w) => (
              <div key={w.id} className="relative flex items-center">
                <ShopTab
                  label={w.name}
                  active={activeShop === w.id}
                  onClick={() => setActiveShop(w.id)}
                />
                <button
                  aria-label="Shop options"
                  onClick={() => setShopMenuFor((c) => (c === w.id ? null : w.id))}
                  className="ml-0.5 h-7 w-7 grid place-items-center rounded-full hover:bg-muted text-muted-foreground"
                >
                  <MoreHorizontal size={14} />
                </button>
                {shopMenuFor === w.id && (
                  <div
                    className="absolute right-0 top-full mt-1 z-20 min-w-[160px] rounded-lg border border-border bg-card shadow-lg text-sm"
                    onMouseLeave={() => setShopMenuFor(null)}
                  >
                    <button
                      onClick={() => {
                        setRenameShop(w);
                        setShopMenuFor(null);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-muted"
                    >
                      {t("inv.renameShop")}
                    </button>
                    <button
                      onClick={() => {
                        setShopMenuFor(null);
                        void removeShop(w);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-muted text-destructive"
                    >
                      {t("inv.deleteShop")}
                    </button>
                  </div>
                )}
              </div>
            ))}
            <button
              onClick={() => setShowAddShop(true)}
              className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              {t("inv.addShop")}
            </button>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            label={t("inv.onShelf")}
            value={inr(totalValue)}
            icon={<Package size={16} className="text-muted-foreground" />}
          />
          <SummaryCard
            label={t("dash.lowStock")}
            value={String(lowCount)}
            icon={<AlertTriangle size={16} className="text-warning" />}
            tone="warn"
          />
          <SummaryCard
            label={t("inv.expiringIn30")}
            value={String(expiringCount)}
            icon={<Clock size={16} className="text-destructive" />}
            tone="danger"
          />
        </section>

        <section className="card-warm p-4 md:p-6">
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("common.search")}
                className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
            <div className="flex items-center gap-1 rounded-full border border-border bg-card p-0.5 text-xs">
              {(["all", "low", "expiring"] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full transition capitalize ${
                    filter === f
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f === "expiring" ? "Expiring" : f === "low" ? t("dash.lowStock") : t("common.all")}
                </button>
              ))}
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 font-medium">{t("inv.item")}</th>
                  <th className="py-2 font-medium">{t("inv.shop")}</th>
                  <th className="py-2 font-medium text-right">{t("inv.stock")}</th>
                  <th className="py-2 font-medium text-right">{t("inv.price")}</th>
                  <th className="py-2 font-medium text-right">{t("inv.expiry")}</th>
                  <th className="py-2 font-medium text-right">{t("inv.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((it) => {
                  const low = it.stock <= it.min_stock;
                  const days = it.expiry ? daysUntil(it.expiry) : null;
                  const expiring = days !== null && days >= 0 && days <= 30;
                  return (
                    <tr key={it.id}>
                      <td className="py-3 text-ink">
                        <div>{it.name}</div>
                        <div className="text-xs text-muted-foreground">{it.category}</div>
                      </td>
                      <td className="py-3 text-muted-foreground text-xs">
                        {shopName(it.warehouse_id)}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        <span className={low ? "text-warning font-medium" : ""}>{it.stock}</span>
                        <span className="text-muted-foreground text-xs"> / {it.min_stock}</span>
                      </td>
                      <td className="py-3 text-right tabular-nums">{inr(it.price)}</td>
                      <td className="py-3 text-right text-xs">
                        {it.expiry ? (
                          <span className={expiring ? "text-destructive" : "text-muted-foreground"}>
                            {new Date(it.expiry).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <RowActions
                          onSale={() => setSaleItem(it)}
                          onAdjust={() => setAdjustItem(it)}
                          onEdit={() => setEditItem(it)}
                          onDelete={async () => {
                            if (!confirm(t("inv.confirmDelete"))) return;
                            const { error } = await supabase
                              .from("inventory_items")
                              .delete()
                              .eq("id", it.id);
                            if (error) alert(error.message);
                            else void loadAll();
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      {dbLoading ? t("common.loading") : t("inv.noItems")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden mt-4 space-y-2">
            {filtered.map((it) => {
              const low = it.stock <= it.min_stock;
              const days = it.expiry ? daysUntil(it.expiry) : null;
              const expiring = days !== null && days >= 0 && days <= 30;
              return (
                <div key={it.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="text-sm font-medium text-ink">{it.name}</div>
                    <div className="text-sm tabular-nums">{inr(it.price)}</div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {it.category} · {shopName(it.warehouse_id)}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className={low ? "text-warning font-medium" : "text-muted-foreground"}>
                      {t("inv.stock")} {it.stock} / {it.min_stock}
                    </span>
                    {it.expiry && (
                      <span className={expiring ? "text-destructive" : "text-muted-foreground"}>
                        {new Date(it.expiry).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2 flex-wrap">
                    <SmallBtn onClick={() => setSaleItem(it)} icon={<ShoppingCart size={12} />}>
                      {t("inv.recordSale")}
                    </SmallBtn>
                    <SmallBtn onClick={() => setAdjustItem(it)} icon={<SlidersHorizontal size={12} />}>
                      {t("inv.adjustStock")}
                    </SmallBtn>
                    <SmallBtn onClick={() => setEditItem(it)} icon={<Pencil size={12} />}>
                      {t("common.edit")}
                    </SmallBtn>
                    <SmallBtn
                      onClick={async () => {
                        if (!confirm(t("inv.confirmDelete"))) return;
                        const { error } = await supabase
                          .from("inventory_items")
                          .delete()
                          .eq("id", it.id);
                        if (error) alert(error.message);
                        else void loadAll();
                      }}
                      icon={<Trash2 size={12} />}
                      danger
                    >
                      {t("common.delete")}
                    </SmallBtn>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {dbLoading ? t("common.loading") : t("inv.noItems")}
              </div>
            )}
          </div>
        </section>
      </div>

      {showAdd && user && (
        <ItemFormModal
          title={t("inv.addItem")}
          showCostPrice={showCostPrice}
          initial={{
            name: "",
            category: "",
            stock: 0,
            min_stock: 0,
            price: 0,
            cost_price: 0,
            expiry: "",
            warehouse_id: defaultShopForNew,
          }}
          warehouses={warehouses}
          onClose={() => setShowAdd(false)}
          onSubmit={async (v) => {
            const { error } = await supabase.from("inventory_items").insert({
              user_id: user.id,
              name: v.name,
              category: v.category ?? "",
              stock: v.stock,
              min_stock: v.min_stock,
              price: v.price,
              cost_price: v.cost_price,
              expiry: v.expiry || null,
              warehouse_id: v.warehouse_id,
            });
            if (error) return error.message;
            void loadAll();
            return null;
          }}
        />
      )}

      {editItem && (
        <ItemFormModal
          title={t("inv.editItem")}
          showCostPrice={showCostPrice}
          initial={{
            name: editItem.name,
            category: editItem.category,
            stock: editItem.stock,
            min_stock: editItem.min_stock,
            price: editItem.price,
            cost_price: editItem.cost_price,
            expiry: editItem.expiry ?? "",
            warehouse_id: editItem.warehouse_id,
          }}
          warehouses={warehouses}
          onClose={() => setEditItem(null)}
          onSubmit={async (v) => {
            const { error } = await supabase
              .from("inventory_items")
              .update({
                name: v.name,
                category: v.category ?? "",
                stock: v.stock,
                min_stock: v.min_stock,
                price: v.price,
                cost_price: v.cost_price,
                expiry: v.expiry || null,
                warehouse_id: v.warehouse_id,
              })
              .eq("id", editItem.id);
            if (error) return error.message;
            void loadAll();
            setEditItem(null);
            return null;
          }}
        />
      )}

      {saleItem && user && (
        <SaleModal
          item={saleItem}
          onClose={() => setSaleItem(null)}
          onSaved={() => {
            setSaleItem(null);
            void loadAll();
          }}
          userId={user.id}
        />
      )}

      {adjustItem && user && (
        <AdjustModal
          item={adjustItem}
          onClose={() => setAdjustItem(null)}
          onSaved={() => {
            setAdjustItem(null);
            void loadAll();
          }}
          userId={user.id}
        />
      )}

      {showAddShop && user && (
        <ShopModal
          title={t("inv.addShop").replace("+ ", "")}
          initial=""
          onClose={() => setShowAddShop(false)}
          onSubmit={async (name) => {
            const { error, data } = await supabase
              .from("warehouses")
              .insert({ user_id: user.id, name })
              .select("id")
              .single();
            if (error) return error.message;
            if (data) setActiveShop(data.id);
            void loadAll();
            setShowAddShop(false);
            return null;
          }}
        />
      )}

      {renameShop && (
        <ShopModal
          title={t("inv.renameShop")}
          initial={renameShop.name}
          onClose={() => setRenameShop(null)}
          onSubmit={async (name) => {
            const { error } = await supabase
              .from("warehouses")
              .update({ name })
              .eq("id", renameShop.id);
            if (error) return error.message;
            void loadAll();
            setRenameShop(null);
            return null;
          }}
        />
      )}
    </AppShell>
  );
}

function ShopTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm transition ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function RowActions({
  onSale,
  onAdjust,
  onEdit,
  onDelete,
}: {
  onSale: () => void;
  onAdjust: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <IconBtn label="Record sale" onClick={onSale}>
        <ShoppingCart size={14} />
      </IconBtn>
      <IconBtn label="Adjust stock" onClick={onAdjust}>
        <SlidersHorizontal size={14} />
      </IconBtn>
      <IconBtn label="Edit" onClick={onEdit}>
        <Pencil size={14} />
      </IconBtn>
      <IconBtn label="Delete" onClick={onDelete} danger>
        <Trash2 size={14} />
      </IconBtn>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`h-8 w-8 grid place-items-center rounded-full hover:bg-muted ${
        danger ? "text-muted-foreground hover:text-destructive" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SmallBtn({
  children,
  onClick,
  icon,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  icon: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] hover:bg-muted ${
        danger ? "text-destructive" : "text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

type ItemFormValues = z.infer<typeof itemSchema>;

function ItemFormModal({
  title,
  initial,
  warehouses,
  showCostPrice = true,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: ItemFormValues;
  warehouses: Warehouse[];
  showCostPrice?: boolean;
  onClose: () => void;
  onSubmit: (v: ItemFormValues) => Promise<string | null>;
}) {
  const { t } = useT();
  const [form, setForm] = useState({
    name: initial.name,
    category: initial.category ?? "",
    stock: String(initial.stock),
    min_stock: String(initial.min_stock),
    price: String(initial.price),
    cost_price: String(initial.cost_price),
    expiry: initial.expiry ?? "",
    warehouse_id: initial.warehouse_id,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const parsed = itemSchema.safeParse({
      name: form.name,
      category: form.category,
      stock: Number(form.stock) || 0,
      min_stock: Number(form.min_stock) || 0,
      price: Number(form.price) || 0,
      cost_price: Number(form.cost_price) || 0,
      expiry: form.expiry,
      warehouse_id: form.warehouse_id,
    });
    if (!parsed.success) {
      setErr(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const errMsg = await onSubmit(parsed.data);
    setBusy(false);
    if (errMsg) setErr(errMsg);
  };

  return (
    <Modal onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-3">
        <MField label={t("common.name")} value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Amul Butter 500g" />
        <MField label={t("inv.category")} value={form.category} onChange={(v) => setForm({ ...form, category: v })} placeholder="Dairy" />
        <div>
          <label className="block text-xs text-muted-foreground mb-1">{t("inv.shop")}</label>
          <select
            value={form.warehouse_id}
            onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MField label={t("inv.stock")} value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} type="number" />
          <MField label={t("inv.minStock")} value={form.min_stock} onChange={(v) => setForm({ ...form, min_stock: v })} type="number" />
        </div>
        <div className={showCostPrice ? "grid grid-cols-2 gap-3" : ""}>
          <MField label={`${t("inv.price")} (₹)`} value={form.price} onChange={(v) => setForm({ ...form, price: v })} type="number" />
          {showCostPrice && (
            <MField label={`${t("inv.costPrice")} (₹)`} value={form.cost_price} onChange={(v) => setForm({ ...form, cost_price: v })} type="number" />
          )}
        </div>
        <MField label={t("inv.expiry")} value={form.expiry} onChange={(v) => setForm({ ...form, expiry: v })} type="date" />
        {err && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>}
        <ModalActions onCancel={onClose} submitLabel={busy ? t("common.loading") : t("common.save")} busy={busy} />
      </form>
    </Modal>
  );
}

function SaleModal({
  item,
  onClose,
  onSaved,
  userId,
}: {
  item: Item;
  onClose: () => void;
  onSaved: () => void;
  userId: string;
}) {
  const { t } = useT();
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState(String(item.price));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const q = Number(qty);
    const p = Number(price);
    if (!Number.isFinite(q) || q <= 0 || !Number.isInteger(q)) {
      setErr("Enter a valid quantity");
      return;
    }
    if (q > item.stock) {
      setErr(t("inv.cannotSellMore"));
      return;
    }
    if (!Number.isFinite(p) || p < 0) {
      setErr("Enter a valid price");
      return;
    }
    setBusy(true);
    // Insert sale, then decrement stock
    const total = q * p;
    const sale = await supabase.from("sales").insert({
      user_id: userId,
      item_id: item.id,
      warehouse_id: item.warehouse_id,
      item_name: item.name,
      quantity: q,
      unit_price: p,
      unit_cost: item.cost_price,
      total,
    });
    if (sale.error) {
      setBusy(false);
      setErr(sale.error.message);
      return;
    }
    const upd = await supabase
      .from("inventory_items")
      .update({ stock: item.stock - q })
      .eq("id", item.id);
    setBusy(false);
    if (upd.error) setErr(upd.error.message);
    else onSaved();
  };

  return (
    <Modal onClose={onClose} title={`${t("inv.recordSale")} · ${item.name}`}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("inv.stock")}: <span className="tabular-nums">{item.stock}</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <MField label={t("inv.quantity")} value={qty} onChange={setQty} type="number" />
          <MField label={`${t("inv.salePrice")} (₹)`} value={price} onChange={setPrice} type="number" />
        </div>
        <div className="text-sm text-muted-foreground">
          {t("common.total")}: <span className="tabular-nums text-ink">₹{((Number(qty) || 0) * (Number(price) || 0)).toLocaleString("en-IN")}</span>
        </div>
        {err && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>}
        <ModalActions onCancel={onClose} submitLabel={busy ? t("common.loading") : t("inv.recordSale")} busy={busy} />
      </form>
    </Modal>
  );
}

function AdjustModal({
  item,
  onClose,
  onSaved,
  userId,
}: {
  item: Item;
  onClose: () => void;
  onSaved: () => void;
  userId: string;
}) {
  const { t } = useT();
  const [newStock, setNewStock] = useState(String(item.stock));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const n = Number(newStock);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      setErr("Enter a valid stock number");
      return;
    }
    if (!reason.trim()) {
      setErr("Reason required");
      return;
    }
    setBusy(true);
    const log = await supabase.from("stock_adjustments").insert({
      user_id: userId,
      item_id: item.id,
      new_stock: n,
      reason: reason.trim(),
    });
    if (log.error) {
      setBusy(false);
      setErr(log.error.message);
      return;
    }
    const upd = await supabase.from("inventory_items").update({ stock: n }).eq("id", item.id);
    setBusy(false);
    if (upd.error) setErr(upd.error.message);
    else onSaved();
  };

  return (
    <Modal onClose={onClose} title={`${t("inv.adjustStock")} · ${item.name}`}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("inv.stock")}: <span className="tabular-nums">{item.stock}</span>
        </p>
        <MField label={t("inv.newStock")} value={newStock} onChange={setNewStock} type="number" />
        <MField label={t("inv.reason")} value={reason} onChange={setReason} placeholder="e.g. Damaged, recount…" />
        {err && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>}
        <ModalActions onCancel={onClose} submitLabel={busy ? t("common.loading") : t("common.save")} busy={busy} />
      </form>
    </Modal>
  );
}

function ShopModal({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<string | null>;
}) {
  const { t } = useT();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const n = name.trim();
    if (!n) return setErr("Name required");
    setBusy(true);
    const errMsg = await onSubmit(n);
    setBusy(false);
    if (errMsg) setErr(errMsg);
  };

  return (
    <Modal onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-3">
        <MField label={t("common.name")} value={name} onChange={setName} placeholder="Main Shop" />
        {err && <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{err}</div>}
        <ModalActions onCancel={onClose} submitLabel={busy ? t("common.loading") : t("common.save")} busy={busy} />
      </form>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md card-warm p-5 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-full hover:bg-muted"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onCancel,
  submitLabel,
  busy,
}: {
  onCancel: () => void;
  submitLabel: string;
  busy?: boolean;
}) {
  const { t } = useT();
  return (
    <div className="flex gap-2 pt-1">
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 rounded-lg border border-border bg-card py-2 text-sm hover:bg-muted"
      >
        {t("common.cancel")}
      </button>
      <button
        type="submit"
        disabled={busy}
        className="flex-1 rounded-lg bg-primary text-primary-foreground py-2 text-sm disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </div>
  );
}

function MField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "warn" | "danger";
}) {
  return (
    <div className="card-warm p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span className="uppercase tracking-wider">{label}</span>
      </div>
      <div
        className={`mt-2 font-display text-2xl tabular-nums ${
          tone === "warn" ? "text-warning" : tone === "danger" ? "text-destructive" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
