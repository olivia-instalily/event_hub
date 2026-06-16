import { useState } from 'react';
import { Home, Calendar, Users, Briefcase } from 'lucide-react';
import { EventsPage } from './components/EventsPage';
import { HomePage } from './components/HomePage';
import { PeoplePage } from './components/PeoplePage';
import { VendorsPage } from './components/VendorsPage';
import { ProfileProvider } from './lib/profile';
import { ProfileSwitcher } from './components/ProfileSwitcher';

export type PeopleStatusFilter = 'all' | 'registered' | 'checkedIn' | 'waitlisted' | 'speakers';
export type EventFilter = { id: string; name: string; tag?: string | null; status?: PeopleStatusFilter };

export default function Component() {
  const [activePage, setActivePage] = useState<'home' | 'events' | 'people' | 'vendors'>('home');
  // Lifted so navigation can leave the Events page and return to the same event detail.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  // When set (and on the People page), People is scoped to this event with a Back button.
  const [peopleEventFilter, setPeopleEventFilter] = useState<EventFilter | null>(null);
  // Bumped on home/Events nav so EventsPage remounts and resets its filters.
  const [eventsNonce, setEventsNonce] = useState(0);
  // Set when arriving at Events via a "Create Event" button, so the modal opens on mount.
  const [createOnEvents, setCreateOnEvents] = useState(false);

  // Event detail → People filtered to that event.
  const viewPeopleForEvent = (filter: EventFilter) => {
    setPeopleEventFilter(filter);
    setActivePage('people');
  };
  // Back from filtered People → the event detail it came from.
  const backToEvent = () => {
    setActivePage('events');
    setPeopleEventFilter(null);
  };

  // Open an event's detail from anywhere (e.g. a Home card).
  const openEvent = (eventId: string) => {
    setSelectedEventId(eventId);
    setPeopleEventFilter(null);
    setActivePage('events');
  };

  const navTo = (page: 'home' | 'events' | 'people' | 'vendors') => {
    setActivePage(page);
    setPeopleEventFilter(null); // manual nav = unscoped
    setCreateOnEvents(false); // plain nav never auto-opens the create modal
    if (page === 'events') {
      setSelectedEventId(null); // Events tab returns to the list
      setEventsNonce((n) => n + 1); // remount EventsPage so it resets to "All"
    }
  };

  // "Create Event" from anywhere (e.g. Home): jump to the Events list with the modal open.
  const createEvent = () => {
    setSelectedEventId(null);
    setPeopleEventFilter(null);
    setEventsNonce((n) => n + 1); // remount so the modal opens fresh
    setCreateOnEvents(true);
    setActivePage('events');
  };

  const tab = (page: 'home' | 'events' | 'people' | 'vendors', icon: React.ReactNode, label: string) => (
    <button
      onClick={() => navTo(page)}
      className={`flex items-center gap-2 px-2 py-1 rounded-lg transition-colors ${
        activePage === page ? 'bg-gray-200 text-black' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <ProfileProvider>
    <div className="min-h-screen bg-white">
      <nav className="bg-white border-b border-black">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              <button onClick={() => navTo('home')} className="text-xl mr-8 hover:opacity-70 transition-opacity" title="Home">InstaEvent</button>
              <div className="flex gap-2">
                {tab('home', <Home className="w-4 h-4" />, 'Home')}
                {tab('events', <Calendar className="w-4 h-4" />, 'Events')}
                {tab('people', <Users className="w-4 h-4" />, 'People')}
                {tab('vendors', <Briefcase className="w-4 h-4" />, 'Vendors')}
              </div>
            </div>
            <ProfileSwitcher />
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {activePage === 'home' && <HomePage onOpenEvent={openEvent} onCreateEvent={createEvent} />}
        {activePage === 'events' && (
          <EventsPage
            key={eventsNonce}
            selectedEventId={selectedEventId}
            setSelectedEventId={setSelectedEventId}
            onViewPeople={viewPeopleForEvent}
            openCreate={createOnEvents}
          />
        )}
        {activePage === 'people' && (
          <PeoplePage
            eventFilter={peopleEventFilter}
            onBack={peopleEventFilter ? backToEvent : undefined}
          />
        )}
        {activePage === 'vendors' && <VendorsPage />}
      </div>
    </div>
    </ProfileProvider>
  );
}
