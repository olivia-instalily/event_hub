import { Bookmark, LayoutGrid, List, ChevronDown, Search, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { listVendors, type VendorRow } from "../lib/db";
import { tagColor } from "../lib/tags";

export function VendorsPage() {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      {/* Filters and View Toggle */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search vendors…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-black rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="appearance-none px-4 py-2 pr-10 bg-white border border-black rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          <button
            onClick={() => setShowBookmarkedOnly((v) => !v)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${showBookmarkedOnly ? 'bg-gray-100' : 'bg-white border border-black hover:bg-gray-50'}`}
          >
            <Bookmark className={`w-4 h-4 ${showBookmarkedOnly ? 'fill-current text-gray-900' : 'text-gray-600'}`} />
          </button>
        </div>

        <div className="flex gap-2 bg-white border border-black rounded-lg p-1">
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
            <div key={v.id} className="bg-white rounded-2xl border border-black p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <span className={`inline-block px-3 py-1 rounded-full text-sm ${tagColor(v.category)}`}>{v.category ?? 'Uncategorized'}</span>
                <button onClick={() => toggleBookmark(v.id)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Bookmark vendor">
                  <Bookmark className={`w-5 h-5 ${bookmarked.has(v.id) ? 'fill-current text-gray-900' : 'text-gray-400'}`} />
                </button>
              </div>
              <h2 className="text-xl mb-1">{v.name ?? <span className="text-gray-400">Unnamed vendor</span>}</h2>
              {v.preferredList && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 mb-2">
                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> Preferred · {v.preferredList}
                </span>
              )}
              {v.notes && <p className="text-sm text-gray-600 mt-2">{v.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Lines View */}
      {!loading && !error && viewMode === 'lines' && filtered.length > 0 && (
        <div className="bg-white rounded-2xl border border-black overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-black">
              <tr>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Vendor</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Category</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Preferred</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Notes</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium">{v.name ?? <span className="text-gray-400">Unnamed</span>}</td>
                  <td className="px-6 py-4"><span className={`inline-block px-3 py-1 rounded-full text-sm ${tagColor(v.category)}`}>{v.category ?? '—'}</span></td>
                  <td className="px-6 py-4 text-sm">{v.preferredList ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 max-w-md">{v.notes ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-6 py-4">
                    <button onClick={() => toggleBookmark(v.id)} className="p-2 hover:bg-gray-200 rounded-lg transition-colors" aria-label="Bookmark vendor">
                      <Bookmark className={`w-4 h-4 ${bookmarked.has(v.id) ? 'fill-current text-gray-900' : 'text-gray-400'}`} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
