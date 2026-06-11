import { Bookmark, Calendar, MapPin, LayoutGrid, List, Plus, ChevronDown } from "lucide-react";
import { useState } from "react";
import { EventDetailPage } from "./EventDetailPage";

const eventsData = [
  {
    id: 1,
    attendeeCount: 45,
    category: "Conference",
    categoryColor: "bg-orange-100 text-orange-700",
    title: "Tech Summit 2026",
    slug: "/events/tech-summit-2026",
    eventType: "In-person",
    location: "San Francisco, CA",
    date: "June 15, 2026",
    status: "future",
    owner: "Sarah Chen",
  },
  {
    id: 2,
    attendeeCount: 120,
    category: "Workshop",
    categoryColor: "bg-purple-100 text-purple-700",
    title: "Design Thinking Workshop",
    slug: "/events/design-thinking-workshop",
    eventType: "Hybrid",
    location: "New York, NY",
    date: "June 22, 2026",
    status: "future",
    owner: "Michael Rodriguez",
  },
  {
    id: 3,
    attendeeCount: 89,
    category: "Networking",
    categoryColor: "bg-blue-100 text-blue-700",
    title: "Startup Mixer",
    slug: "/events/startup-mixer-june",
    eventType: "In-person",
    location: "Austin, TX",
    date: "June 18, 2026",
    status: "future",
    owner: "Emily Watson",
  },
  {
    id: 4,
    attendeeCount: 200,
    category: "Webinar",
    categoryColor: "bg-green-100 text-green-700",
    title: "AI & Machine Learning Trends",
    slug: "/events/ai-ml-trends-webinar",
    eventType: "Hybrid",
    location: "Online",
    date: "June 25, 2026",
    status: "future",
    owner: "David Kim",
  },
  {
    id: 5,
    attendeeCount: 67,
    category: "Conference",
    categoryColor: "bg-orange-100 text-orange-700",
    title: "Product Management Summit",
    slug: "/events/pm-summit-2026",
    eventType: "In-person",
    location: "Seattle, WA",
    date: "July 10, 2026",
    status: "future",
    owner: "Jennifer Lee",
  },
  {
    id: 6,
    attendeeCount: 34,
    category: "Workshop",
    categoryColor: "bg-purple-100 text-purple-700",
    title: "Advanced React Patterns",
    slug: "/events/react-patterns-workshop",
    eventType: "Hybrid",
    location: "Online",
    date: "June 28, 2026",
    status: "future",
    owner: "Sarah Chen",
  },
  {
    id: 7,
    attendeeCount: 156,
    category: "Conference",
    categoryColor: "bg-orange-100 text-orange-700",
    title: "Spring Tech Conference 2026",
    slug: "/events/spring-tech-2026",
    eventType: "In-person",
    location: "New York, NY",
    date: "May 15, 2026",
    status: "in-process",
    owner: "Alex Thompson",
  },
  {
    id: 8,
    attendeeCount: 78,
    category: "Networking",
    categoryColor: "bg-blue-100 text-blue-700",
    title: "Industry Mixer May",
    slug: "/events/industry-mixer-may",
    eventType: "In-person",
    location: "San Francisco, CA",
    date: "May 20, 2026",
    status: "in-process",
    owner: "Michael Rodriguez",
  },
  {
    id: 9,
    attendeeCount: 234,
    category: "Conference",
    categoryColor: "bg-orange-100 text-orange-700",
    title: "Winter Summit 2025",
    slug: "/events/winter-summit-2025",
    eventType: "In-person",
    location: "Chicago, IL",
    date: "March 10, 2026",
    status: "past",
    owner: "Sarah Chen",
  },
  {
    id: 10,
    attendeeCount: 145,
    category: "Workshop",
    categoryColor: "bg-purple-100 text-purple-700",
    title: "Leadership Workshop",
    slug: "/events/leadership-workshop-march",
    eventType: "Hybrid",
    location: "Austin, TX",
    date: "April 5, 2026",
    status: "past",
    owner: "David Kim",
  },
];

export function EventsPage() {
  const [bookmarkedEvents, setBookmarkedEvents] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<'cards' | 'lines'>('cards');
  const [statusFilter, setStatusFilter] = useState<'future' | 'in-process' | 'past'>('future');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [showBookmarkedOnly, setShowBookmarkedOnly] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const toggleBookmark = (eventId: number) => {
    setBookmarkedEvents((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  };

  // Get unique locations and owners for filters
  const locations = Array.from(new Set(eventsData.map(e => e.location)));
  const owners = Array.from(new Set(eventsData.map(e => e.owner)));

  // Filter events
  const filteredEvents = eventsData.filter(event => {
    if (event.status !== statusFilter) return false;
    if (locationFilter !== 'all' && event.location !== locationFilter) return false;
    if (ownerFilter !== 'all' && event.owner !== ownerFilter) return false;
    if (showBookmarkedOnly && !bookmarkedEvents.has(event.id)) return false;
    return true;
  });

  // If an event is selected, show the detail page
  if (selectedEventId !== null) {
    return (
      <EventDetailPage
        eventId={selectedEventId}
        onBack={() => setSelectedEventId(null)}
      />
    );
  }

  return (
    <div>
      {/* Status Tabs */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => setStatusFilter('future')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              statusFilter === 'future'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Future Events
          </button>
          <button
            onClick={() => setStatusFilter('in-process')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              statusFilter === 'in-process'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            In-Process
          </button>
          <button
            onClick={() => setStatusFilter('past')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              statusFilter === 'past'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Past Events
          </button>
        </div>
        
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" />
          Create Event
        </button>
      </div>

      {/* Filters and View Toggle */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-3">
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

          {/* Owner Filter */}
          <div className="relative">
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="appearance-none px-4 py-2 pr-10 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
            >
              <option value="all">All Owners</option>
              {owners.map(owner => (
                <option key={owner} value={owner}>{owner}</option>
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
          {filteredEvents.map((event) => (
            <div
              key={event.id}
              className="bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setSelectedEventId(event.id)}
            >
              {/* Header with attendee count and bookmark */}
              <div className="flex items-start justify-between mb-4">
                <p className="text-gray-500">
                  {event.attendeeCount} attendee{event.attendeeCount !== 1 ? "s" : ""}
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleBookmark(event.id);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="Bookmark event"
                >
                  <Bookmark
                    className={`w-5 h-5 ${
                      bookmarkedEvents.has(event.id)
                        ? "fill-current text-gray-900"
                        : "text-gray-400"
                    }`}
                  />
                </button>
              </div>

              {/* Category badge */}
              <div className="mb-3">
                <span
                  className={`inline-block px-3 py-1 rounded-full text-sm ${event.categoryColor}`}
                >
                  {event.category}
                </span>
              </div>

              {/* Event title */}
              <h2 className="text-xl mb-2">{event.title}</h2>

              {/* Event slug */}
              <p className="text-gray-500 text-sm mb-4">{event.slug}</p>

              {/* Event details */}
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {event.date}
                </span>
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm">
                  {event.eventType}
                </span>
                <span className="px-3 py-1 bg-gray-100 rounded-md text-sm flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {event.location}
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
                <th className="text-left px-6 py-3 text-sm text-gray-600">Event</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Category</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Date</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Location</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Owner</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Attendees</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600"></th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((event) => (
                <tr key={event.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium">{event.title}</p>
                      <p className="text-sm text-gray-500">{event.slug}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-block px-3 py-1 rounded-full text-sm ${event.categoryColor}`}>
                      {event.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">{event.date}</td>
                  <td className="px-6 py-4 text-sm">{event.location}</td>
                  <td className="px-6 py-4 text-sm">{event.owner}</td>
                  <td className="px-6 py-4 text-sm">{event.attendeeCount}</td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => toggleBookmark(event.id)}
                      className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      <Bookmark
                        className={`w-4 h-4 ${
                          bookmarkedEvents.has(event.id)
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