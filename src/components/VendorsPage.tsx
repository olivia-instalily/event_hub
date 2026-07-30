import { Bookmark, LayoutGrid, List, Search, Star, Calendar as CalendarIcon, CheckCircle2, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@instalily/ui/select";
import { useEffect, useState } from "react";
import { listVendors, getVendorUsage, deleteVendor, type VendorRow, type VendorUsage } from "../lib/db";
import { tagBadgeVariant } from "../lib/tags";
import { Badge } from "@instalily/ui/badge";
import { Input } from "@instalily/ui/input";
import { DataTable } from "@instalily/ui/data-table";
import type { ColumnDef } from "@tanstack/react-table";

export function VendorsPage() {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which vendor's "used at" detail is expanded, and a cache of each vendor's engagements.
  const [openId, setOpenId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, VendorUsage[] | "loading">>({});
  const openVendor = (id: string) => {
    setOpenId((cur) => (cur === id ? null : id));
    if (usage[id] === undefined) {
      setUsage((m) => ({ ...m, [id]: "loading" }));
      getVendorUsage(id).then((u) => setUsage((m) => ({ ...m, [id]: u }))).catch(() => setUsage((m) => ({ ...m, [id]: [] })));
    }
  };

  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'cards' | 'lines'>('cards');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showBookmarkedOnly, setShowBookmarkedOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listVendors()
      .then((v) => { if (!cancelled) setVendors(v); })
      .catch((e) => { if (!cancelled) setError(e.message ?? String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const toggleBookmark = (id: string) => setBookmarked((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const [confirmDelete, setConfirmDelete] = useState<VendorRow | null>(null);
  const removeVendor = async (v: VendorRow) => {
    setVendors((prev) => prev.filter((x) => x.id !== v.id));
    setConfirmDelete(null);
    await deleteVendor(v.id).catch(() => {});
  };

  const categories = Array.from(new Set(vendors.map((v) => v.category).filter(Boolean))) as string[];

  const filtered = vendors.filter((v) => {
    if (categoryFilter !== 'all' && v.category !== categoryFilter) return false;
    if (showBookmarkedOnly && !bookmarked.has(v.id)) return false;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const hay = `${v.name ?? ''} ${v.category ?? ''} ${v.preferredList ?? ''} ${v.notes ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Columns for the brand DataTable (lines view). Search/category/bookmark stay as the
  // page's own controls above, so DataTable's built-in search/export are turned off.
  const vendorColumns: ColumnDef<VendorRow>[] = [
    { accessorKey: "name", header: "Vendor", cell: ({ row }) => row.original.name ?? <span className="text-gray-400">Unnamed</span> },
    { accessorKey: "category", header: "Category", cell: ({ row }) => <Badge variant={tagBadgeVariant(row.original.category)}>{row.original.category ?? "—"}</Badge> },
    { accessorKey: "preferredList", header: "Preferred", cell: ({ row }) => row.original.preferredList ?? <span className="text-gray-300">—</span> },
    { accessorKey: "notes", header: "Notes", enableSorting: false, cell: ({ row }) => row.original.notes ?? <span className="text-gray-300">—</span> },
    {
      id: "actions", header: "", enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <button onClick={() => toggleBookmark(row.original.id)} className="p-2 hover:bg-gray-200 rounded-lg transition-colors" aria-label="Bookmark vendor">
            <Bookmark className={`w-4 h-4 ${bookmarked.has(row.original.id) ? "fill-current text-gray-900" : "text-gray-400"}`} />
          </button>
          <button onClick={() => setConfirmDelete(row.original)} className="p-2 hover:bg-red-50 rounded-lg transition-colors text-gray-300 hover:text-red-500" aria-label="Delete vendor">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Filters and View Toggle */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 z-10" />
            <Input
              type="text"
              placeholder="Search vendors…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-64 pl-10"
            />
          </div>
          <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as string)} items={[{ value: "all", label: "All Categories" }, ...categories.map((c) => ({ value: c, label: c }))]}>
            <SelectTrigger className="h-10 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <button
            onClick={() => setShowBookmarkedOnly((v) => !v)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${showBookmarkedOnly ? 'bg-gray-100' : 'bg-white border border-border hover:bg-gray-50'}`}
          >
            <Bookmark className={`w-4 h-4 ${showBookmarkedOnly ? 'fill-current text-gray-900' : 'text-gray-600'}`} />
          </button>
        </div>

        <div className="flex gap-2 bg-white border border-border rounded-lg p-1">
          <button onClick={() => setViewMode('cards')} className={`p-2 rounded transition-colors ${viewMode === 'cards' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}><LayoutGrid className="w-4 h-4" /></button>
          <button onClick={() => setViewMode('lines')} className={`p-2 rounded transition-colors ${viewMode === 'lines' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}><List className="w-4 h-4" /></button>
        </div>
      </div>

      {loading && <p className="text-gray-500 py-12 text-center">Loading vendors…</p>}
      {error && <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">Couldn’t load vendors: {error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p className="text-gray-400 py-12 text-center">No vendors{vendors.length ? ' match your filters' : ' yet'}.</p>
      )}

      {/* Cards View */}
      {!loading && !error && viewMode === 'cards' && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map((v) => (
            <div key={v.id} onClick={() => openVendor(v.id)} className={`bg-white rounded-2xl border p-6 hover:shadow-md transition-shadow cursor-pointer ${openId === v.id ? "border-gray-400 shadow-sm" : "border-border"}`}>
              <div className="flex items-start justify-between mb-3">
                <Badge variant={tagBadgeVariant(v.category)}>{v.category ?? 'Uncategorized'}</Badge>
                <div className="flex items-center">
                  <button onClick={(e) => { e.stopPropagation(); toggleBookmark(v.id); }} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Bookmark vendor">
                    <Bookmark className={`w-5 h-5 ${bookmarked.has(v.id) ? 'fill-current text-gray-900' : 'text-gray-400'}`} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(v); }} className="p-2 hover:bg-red-50 rounded-lg transition-colors text-gray-300 hover:text-red-500" aria-label="Delete vendor">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <h2 className="text-xl mb-1">{v.name ?? <span className="text-gray-400">Unnamed vendor</span>}</h2>
              {v.preferredList && (
                <span className="inline-flex items-center gap-1 text-[15px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 mb-2">
                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> Preferred · {v.preferredList}
                </span>
              )}
              {v.notes && <p className="text-sm text-gray-600 mt-2">{v.notes}</p>}
              {/* "Used at" — events/series this vendor has been engaged on (click to expand). */}
              {openId === v.id && (
                <div className="mt-4 pt-3 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                  <p className="text-[13px] font-medium text-gray-500 mb-2">Used at</p>
                  <VendorUsageList usage={usage[v.id]} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lines View — brand DataTable (sortable + paginated); fed the already-filtered rows. */}
      {!loading && !error && viewMode === 'lines' && filtered.length > 0 && (
        <div className="bg-white rounded-2xl border border-border overflow-hidden">
          <DataTable
            data={filtered}
            columns={vendorColumns}
            getRowId={(v) => v.id}
            enableSearch={false}
            enableExport={false}
            enableColumnHiding={false}
            enableRowSelection={false}
          />
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl border border-gray-200 max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg mb-1">Delete “{confirmDelete.name ?? "vendor"}”?</h3>
            <p className="text-sm text-gray-600 mb-5">Removes it from the directory. Budget rows that used it keep the name but unlink — nothing about their cost changes.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button onClick={() => removeVendor(confirmDelete)} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const fmtUsageDate = (d: string | null) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null);

function VendorUsageList({ usage }: { usage: VendorUsage[] | "loading" | undefined }) {
  if (usage === "loading" || usage === undefined) return <p className="text-[13px] text-gray-400">Loading…</p>;
  if (usage.length === 0) return <p className="text-[13px] text-gray-400">Not used on any event yet.</p>;
  return (
    <ul className="space-y-1.5">
      {usage.map((u) => (
        <li key={u.engagementId} className="flex items-start gap-2 text-[13px]">
          {u.contracted ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" /> : <CalendarIcon className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />}
          <span className="min-w-0">
            <span className="text-gray-800">{u.eventName ?? u.seriesName ?? "Untitled"}</span>
            {u.category && <span className="text-gray-400"> · {u.category}</span>}
            <span className="block text-[11px] text-gray-400">
              {u.contracted ? "Contracted" : "Sourced"}{fmtUsageDate(u.date) ? ` · ${fmtUsageDate(u.date)}` : ""}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
