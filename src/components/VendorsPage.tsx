import { Bookmark, Star, LayoutGrid, List, ChevronDown } from "lucide-react";
import { useState } from "react";

const vendorsData = [
  {
    id: 1,
    projectsCount: 23,
    category: "Catering",
    categoryColor: "bg-orange-100 text-orange-700",
    name: "Gourmet Events Catering",
    slug: "/vendors/gourmet-events-catering",
    rating: 4.8,
    serviceType: "Full Service",
    location: "New York, NY",
  },
  {
    id: 2,
    projectsCount: 67,
    category: "Photography",
    categoryColor: "bg-purple-100 text-purple-700",
    name: "Lens & Light Studios",
    slug: "/vendors/lens-light-studios",
    rating: 4.9,
    serviceType: "Professional",
    location: "Los Angeles, CA",
  },
  {
    id: 3,
    projectsCount: 45,
    category: "Venue",
    categoryColor: "bg-blue-100 text-blue-700",
    name: "Grand Ballroom Events",
    slug: "/vendors/grand-ballroom-events",
    rating: 4.7,
    serviceType: "Premium",
    location: "San Francisco, CA",
  },
  {
    id: 4,
    projectsCount: 89,
    category: "Audio/Visual",
    categoryColor: "bg-green-100 text-green-700",
    name: "SoundWave Productions",
    slug: "/vendors/soundwave-productions",
    rating: 4.6,
    serviceType: "Full Service",
    location: "Austin, TX",
  },
  {
    id: 5,
    projectsCount: 34,
    category: "Florist",
    categoryColor: "bg-pink-100 text-pink-700",
    name: "Bloom & Blossom",
    slug: "/vendors/bloom-blossom",
    rating: 5.0,
    serviceType: "Boutique",
    location: "Seattle, WA",
  },
  {
    id: 6,
    projectsCount: 56,
    category: "Entertainment",
    categoryColor: "bg-red-100 text-red-700",
    name: "Party Rockers DJ Service",
    slug: "/vendors/party-rockers-dj",
    rating: 4.8,
    serviceType: "Professional",
    location: "Miami, FL",
  },
  {
    id: 7,
    projectsCount: 41,
    category: "Catering",
    categoryColor: "bg-orange-100 text-orange-700",
    name: "Elite Cuisine Catering",
    slug: "/vendors/elite-cuisine",
    rating: 4.7,
    serviceType: "Premium",
    location: "Chicago, IL",
  },
  {
    id: 8,
    projectsCount: 72,
    category: "Venue",
    categoryColor: "bg-blue-100 text-blue-700",
    name: "Skyline Event Center",
    slug: "/vendors/skyline-event-center",
    rating: 4.9,
    serviceType: "Full Service",
    location: "New York, NY",
  },
];

export function VendorsPage() {
  const [bookmarkedVendors, setBookmarkedVendors] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<'cards' | 'lines'>('cards');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [showBookmarkedOnly, setShowBookmarkedOnly] = useState(false);

  const toggleBookmark = (vendorId: number) => {
    setBookmarkedVendors((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(vendorId)) {
        newSet.delete(vendorId);
      } else {
        newSet.add(vendorId);
      }
      return newSet;
    });
  };

  // Get unique categories and locations for filters
  const categories = Array.from(new Set(vendorsData.map(v => v.category)));
  const locations = Array.from(new Set(vendorsData.map(v => v.location)));

  // Filter vendors
  const filteredVendors = vendorsData.filter(vendor => {
    if (categoryFilter !== 'all' && vendor.category !== categoryFilter) return false;
    if (locationFilter !== 'all' && vendor.location !== locationFilter) return false;
    if (showBookmarkedOnly && !bookmarkedVendors.has(vendor.id)) return false;
    return true;
  });

  return (
    <div>
      {/* Filters and View Toggle */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-3">
          {/* Category Filter */}
          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="appearance-none px-4 py-2 pr-10 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
            >
              <option value="all">All Types</option>
              {categories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          {/* Location Filter */}
          <div className="relative">
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="appearance-none px-4 py-2 pr-10 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
            >
              <option value="all">All Locations</option>
              {locations.map(location => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          {/* Bookmarked Only Filter */}
          <button
            onClick={() => setShowBookmarkedOnly(!showBookmarkedOnly)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
              showBookmarkedOnly ? 'bg-gray-100' : 'bg-white border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${
              showBookmarkedOnly ? 'fill-current text-gray-900' : 'text-gray-600'
            }`} />
          </button>
        </div>

        {/* View Toggle */}
        <div className="flex gap-2 bg-white border border-gray-200 rounded-lg p-1">
          <button
            onClick={() => setViewMode('cards')}
            className={`p-2 rounded transition-colors ${
              viewMode === 'cards' ? 'bg-gray-100' : 'hover:bg-gray-50'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('lines')}
            className={`p-2 rounded transition-colors ${
              viewMode === 'lines' ? 'bg-gray-100' : 'hover:bg-gray-50'
            }`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Cards View */}
      {viewMode === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredVendors.map((vendor) => (
            <div
              key={vendor.id}
              className="bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-md transition-shadow cursor-pointer"
            >
              {/* Header with projects count and bookmark */}
              <div className="flex items-start justify-between mb-4">
                <p className="text-gray-500">
                  {vendor.projectsCount} project{vendor.projectsCount !== 1 ? "s" : ""}
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleBookmark(vendor.id);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="Bookmark vendor"
                >
                  <Bookmark
                    className={`w-5 h-5 ${
                      bookmarkedVendors.has(vendor.id)
                        ? "fill-current text-gray-900"
                        : "text-gray-400"
                    }`}
                  />
                </button>
              </div>

              {/* Category badge */}
              <div className="mb-3">
                <span
                  className={`inline-block px-3 py-1 rounded-full text-sm ${vendor.categoryColor}`}
                >
                  {vendor.category}
                </span>
              </div>

              {/* Vendor name */}
              <h2 className="text-xl mb-2">{vendor.name}</h2>

              {/* Vendor slug */}
              <p className="text-gray-500 text-sm mb-4">{vendor.slug}</p>

              {/* Vendor details */}
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm flex items-center gap-1">
                  <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                  {vendor.rating}
                </span>
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm">
                  {vendor.serviceType}
                </span>
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm">
                  {vendor.location}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lines View */}
      {viewMode === 'lines' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Vendor</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Category</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Rating</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Service Type</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Location</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Projects</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600"></th>
              </tr>
            </thead>
            <tbody>
              {filteredVendors.map((vendor) => (
                <tr key={vendor.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium">{vendor.name}</p>
                      <p className="text-sm text-gray-500">{vendor.slug}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-block px-3 py-1 rounded-full text-sm ${vendor.categoryColor}`}>
                      {vendor.category}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1">
                      <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                      <span className="text-sm">{vendor.rating}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm">{vendor.serviceType}</td>
                  <td className="px-6 py-4 text-sm">{vendor.location}</td>
                  <td className="px-6 py-4 text-sm">{vendor.projectsCount}</td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => toggleBookmark(vendor.id)}
                      className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      <Bookmark
                        className={`w-4 h-4 ${
                          bookmarkedVendors.has(vendor.id)
                            ? "fill-current text-gray-900"
                            : "text-gray-400"
                        }`}
                      />
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