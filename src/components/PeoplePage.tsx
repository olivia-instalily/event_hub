import { Bookmark, LayoutGrid, List, Search, ChevronDown } from "lucide-react";
import { useState } from "react";

const peopleData = [
  {
    id: 1,
    connectionsCount: 234,
    category: "Engineering",
    categoryColor: "bg-orange-100 text-orange-700",
    name: "Sarah Chen",
    slug: "/people/sarah-chen",
    role: "Senior Engineer",
    company: "TechCorp",
    location: "San Francisco, CA",
    type: "hiring",
  },
  {
    id: 2,
    connectionsCount: 567,
    category: "Product",
    categoryColor: "bg-blue-100 text-blue-700",
    name: "Michael Rodriguez",
    slug: "/people/michael-rodriguez",
    role: "Product Manager",
    company: "StartupXYZ",
    location: "New York, NY",
    type: "icp",
  },
  {
    id: 3,
    connectionsCount: 892,
    category: "Design",
    categoryColor: "bg-purple-100 text-purple-700",
    name: "Emily Watson",
    slug: "/people/emily-watson",
    role: "Lead Designer",
    company: "DesignStudio",
    location: "Remote",
    type: "icp",
  },
  {
    id: 4,
    connectionsCount: 145,
    category: "Business",
    categoryColor: "bg-red-100 text-red-700",
    name: "David Kim",
    slug: "/people/david-kim",
    role: "Sales Director",
    company: "SalesCo",
    location: "Chicago, IL",
    type: "hiring",
  },
  {
    id: 5,
    connectionsCount: 423,
    category: "Engineering",
    categoryColor: "bg-orange-100 text-orange-700",
    name: "Jennifer Lee",
    slug: "/people/jennifer-lee",
    role: "Full Stack Developer",
    company: "DevShop",
    location: "Austin, TX",
    type: "hiring",
  },
  {
    id: 6,
    connectionsCount: 678,
    category: "Marketing",
    categoryColor: "bg-pink-100 text-pink-700",
    name: "Alex Thompson",
    slug: "/people/alex-thompson",
    role: "Marketing Manager",
    company: "BrandCo",
    location: "Los Angeles, CA",
    type: "icp",
  },
  {
    id: 7,
    connectionsCount: 321,
    category: "Engineering",
    categoryColor: "bg-orange-100 text-orange-700",
    name: "Robert Garcia",
    slug: "/people/robert-garcia",
    role: "Backend Developer",
    company: "CloudTech",
    location: "Seattle, WA",
    type: "hiring",
  },
  {
    id: 8,
    connectionsCount: 189,
    category: "Product",
    categoryColor: "bg-blue-100 text-blue-700",
    name: "Lisa Anderson",
    slug: "/people/lisa-anderson",
    role: "Product Designer",
    company: "DesignCo",
    location: "Remote",
    type: "icp",
  },
];

export function PeoplePage() {
  const [bookmarkedPeople, setBookmarkedPeople] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<'cards' | 'lines'>('cards');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [showBookmarkedOnly, setShowBookmarkedOnly] = useState(false);

  const toggleBookmark = (personId: number) => {
    setBookmarkedPeople((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(personId)) {
        newSet.delete(personId);
      } else {
        newSet.add(personId);
      }
      return newSet;
    });
  };

  // Get unique locations for filter
  const locations = Array.from(new Set(peopleData.map(p => p.location)));

  // Filter people
  const filteredPeople = peopleData.filter(person => {
    const matchesSearch = person.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         person.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         person.company.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (typeFilter !== 'all' && person.type !== typeFilter) return false;
    if (locationFilter !== 'all' && person.location !== locationFilter) return false;
    if (showBookmarkedOnly && !bookmarkedPeople.has(person.id)) return false;
    return true;
  });

  return (
    <div>
      {/* Search and Filters */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-3 flex-1 max-w-2xl">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search people..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Type Filter */}
          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="appearance-none px-4 py-2 pr-10 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="hiring">Hiring</option>
              <option value="icp">ICP</option>
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
            className={`p-2 rounded transition-colors ${
              showBookmarkedOnly ? 'bg-gray-100' : 'hover:bg-gray-50'
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
          {filteredPeople.map((person) => (
            <div
              key={person.id}
              className="bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-md transition-shadow cursor-pointer"
            >
              {/* Header with connections count and bookmark */}
              <div className="flex items-start justify-between mb-4">
                <p className="text-gray-500">
                  {person.connectionsCount} connection{person.connectionsCount !== 1 ? "s" : ""}
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleBookmark(person.id);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="Bookmark person"
                >
                  <Bookmark
                    className={`w-5 h-5 ${
                      bookmarkedPeople.has(person.id)
                        ? "fill-current text-gray-900"
                        : "text-gray-400"
                    }`}
                  />
                </button>
              </div>

              {/* Category badge */}
              <div className="mb-3">
                <span
                  className={`inline-block px-3 py-1 rounded-full text-sm ${person.categoryColor}`}
                >
                  {person.category}
                </span>
              </div>

              {/* Person name */}
              <h2 className="text-xl mb-2">{person.name}</h2>

              {/* Person slug */}
              <p className="text-gray-500 text-sm mb-4">{person.slug}</p>

              {/* Person details */}
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm">
                  {person.role}
                </span>
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm">
                  {person.company}
                </span>
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm">
                  {person.location}
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
                <th className="text-left px-6 py-3 text-sm text-gray-600">Name</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Category</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Role</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Company</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Location</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Type</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Connections</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600"></th>
              </tr>
            </thead>
            <tbody>
              {filteredPeople.map((person) => (
                <tr key={person.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium">{person.name}</p>
                      <p className="text-sm text-gray-500">{person.slug}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-block px-3 py-1 rounded-full text-sm ${person.categoryColor}`}>
                      {person.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">{person.role}</td>
                  <td className="px-6 py-4 text-sm">{person.company}</td>
                  <td className="px-6 py-4 text-sm">{person.location}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-block px-2 py-1 rounded text-xs ${
                      person.type === 'hiring' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {person.type.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">{person.connectionsCount}</td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => toggleBookmark(person.id)}
                      className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      <Bookmark
                        className={`w-4 h-4 ${
                          bookmarkedPeople.has(person.id)
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