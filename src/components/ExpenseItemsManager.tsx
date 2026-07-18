import { useMemo, useState } from "react";
import { X, Plus, Search, Check, Pencil, Trash2, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

export type ExpenseItem = {
  id: string;
  name: string;
  category: string;
  usage_count: number;
  last_used_at: string | null;
};

// Loose escape-hatch for the newer table, matching the convention already
// used in reports.tsx / vendors.tsx / create-bill.tsx.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = { from: (t: string) => any };
const sb = supabase as unknown as Sb;

/**
 * Chart of Accounts manager — the expense-item master list itself. Lets an
 * owner/manager browse, search, rename, re-categorize, add, and remove
 * standardized expense items (e.g. "Maggi 90g", "Shop Rent") outside the
 * flow of logging a single expense. Lives under Inventory alongside the
 * other master-data lists; the Expenses page still uses these items when
 * logging a new expense, but manages them here.
 */
export function ExpenseItemsManager({
  userId,
  items,
  onClose,
  onChanged,
}: {
  userId: string;
  items: ExpenseItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, formatNumber } = useT();
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("General");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? items.filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)) : items;
    return [...list].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, ExpenseItem[]>();
    for (const i of filtered) {
      const arr = map.get(i.category) ?? [];
      arr.push(i);
      map.set(i.category, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const addItem = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    const { error } = await sb.from("expense_items").insert({
      user_id: userId,
      name,
      category: newCategory.trim() || "General",
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setNewName("");
    onChanged();
  };

  const startEdit = (item: ExpenseItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditCategory(item.category);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    const { error } = await sb
      .from("expense_items")
      .update({ name, category: editCategory.trim() || "General" })
      .eq("id", editingId);
    setBusy(false);
    if (error) return setErr(error.message);
    setEditingId(null);
    onChanged();
  };

  const remove = async (item: ExpenseItem) => {
    if (!confirm(t("exp.confirmRemoveItem"))) return;
    setErr(null);
    const { error } = await sb.from("expense_items").delete().eq("id", item.id);
    if (error) return setErr(error.message);
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto card-warm p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute right-3 top-3 h-8 w-8 grid place-items-center rounded-full hover:bg-muted"
        >
          <X size={16} />
        </button>
        <h2 className="font-display text-2xl text-ink flex items-center gap-2">
          <BookOpen size={18} className="text-muted-foreground" /> {t("exp.chartOfAccounts")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("exp.chartOfAccountsHint")}</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto] rounded-lg border border-border p-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("exp.newItemNamePlaceholder")}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            list="chart-category-list"
            placeholder={t("exp.category")}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40 sm:w-40"
          />
          <datalist id="chart-category-list">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={addItem}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm disabled:opacity-60"
          >
            <Plus size={14} /> {t("common.add")}
          </button>
        </div>

        <div className="relative mt-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("exp.searchItemPlaceholder")}
            className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>

        {err && <div className="mt-3 rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">{err}</div>}

        <div className="mt-4 space-y-4">
          {grouped.map(([category, list]) => (
            <div key={category}>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">{category}</div>
              <div className="space-y-1.5">
                {list.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border p-2.5">
                    {editingId === item.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                          className="flex-1 min-w-[8rem] rounded-md border border-border bg-card px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                        />
                        <input
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          list="chart-category-list"
                          className="w-32 rounded-md border border-border bg-card px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                        />
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={busy}
                          aria-label={t("common.save")}
                          className="h-7 w-7 grid place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-60"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          aria-label={t("common.cancel")}
                          className="h-7 w-7 grid place-items-center rounded-full hover:bg-muted"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm text-ink truncate">{item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatNumber(item.usage_count)} {t("exp.timesUsed")}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEdit(item)}
                            aria-label={t("common.edit")}
                            className="h-7 w-7 grid place-items-center rounded-full hover:bg-muted text-muted-foreground"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(item)}
                            aria-label={t("exp.remove")}
                            className="h-7 w-7 grid place-items-center rounded-full hover:bg-muted text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {grouped.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("exp.noItemsYet")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
