import { useRef, useState } from 'react';
import { Home, Calendar, Users, Briefcase, DollarSign, Plus } from 'lucide-react';
import { filesFromDrop } from './lib/drop';
import { looksLikeBackfill } from './lib/backfill';
import { EventsPage } from './components/EventsPage';
import { HomePage } from './components/HomePage';
import { PeoplePage } from './components/PeoplePage';
import { VendorsPage } from './components/VendorsPage';
import { BudgetPage } from './components/BudgetPage';
import { ProfileProvider } from './lib/profile';
import { ProfileSwitcher } from './components/ProfileSwitcher';
import { Tabs, TabsList, TabsTrigger } from '@instalily/ui/tabs';

export type PeopleStatusFilter = 'all' | 'registered' | 'checkedIn' | 'waitlisted' | 'speakers';
export type EventFilter = { id: string; name: string; tag?: string | null; status?: PeopleStatusFilter };

export default function Component() {
  const [activePage, setActivePage] = useState<'home' | 'events' | 'people' | 'vendors' | 'budget'>('home');
  // Lifted so navigation can leave the Events page and return to the same event detail.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  // When set (and on the People page), People is scoped to this event with a Back button.
  const [peopleEventFilter, setPeopleEventFilter] = useState<EventFilter | null>(null);
  // Bumped on home/Events nav so EventsPage remounts and resets its filters.
  const [eventsNonce, setEventsNonce] = useState(0);
  // Set when arriving at Events via a "Create Event" button, so the modal opens on mount.
  const [createOnEvents, setCreateOnEvents] = useState(false);
  // Which page an open event was launched from, so its Back button returns there
  // (e.g. a Home todo → Back to Home, a Budget row → Back to Budget).
  type Page = 'home' | 'events' | 'people' | 'vendors' | 'budget';
  const [eventOrigin, setEventOrigin] = useState<Page>('events');
  // Files dropped anywhere on the page → jump to Events, open Create, ingest straight to review.
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);
  const [droppedLooksPast, setDroppedLooksPast] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const onAppDrop = async (files: File[]) => {
    if (!files.length) return;
    // Light sniff: a dropped debrief/recap is a BACKFILL, not a create. If it looks past, hand
    // EventsPage a flag so it asks (past vs in-process) instead of barreling into the create flow.
    let suspect = false;
    try {
      const texty = files.find((f) => /text|json|csv|markdown|plain/i.test(f.type) || /\.(txt|md|vtt|srt|csv|json)$/i.test(f.name)) ?? files[0];
      suspect = looksLikeBackfill(await texty.text());
    } catch { /* unreadable — treat as create */ }
    setDroppedFiles(files);
    setDroppedLooksPast(suspect);
    setSelectedEventId(null);
    setPeopleEventFilter(null);
    setCreateOnEvents(!suspect); // suspect → EventsPage shows the chooser, not the create modal
    setEventsNonce((n) => n + 1);
    setActivePage('events');
  };

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

  // Open an event's detail from anywhere (e.g. a Home card, the Budget page). The event
  // view always renders under the Events tab; `origin` records where to return on Back.
  const openEvent = (eventId: string, origin: Page = 'events') => {
    setSelectedEventId(eventId);
    setEventOrigin(origin);
    setPeopleEventFilter(null);
    setActivePage('events');
  };

  // Setter handed to EventsPage. Opening an event from its own list resets the origin to
  // Events; closing one (id → null) returns to wherever it was opened from.
  const setSelectedFromEvents = (id: string | null) => {
    setSelectedEventId(id);
    if (id === null) {
      // Back from the event detail → return to the page it was launched from.
      if (eventOrigin !== 'events') setActivePage(eventOrigin);
      setEventOrigin('events');
    } else {
      setEventOrigin('events');
    }
  };

  const navTo = (page: 'home' | 'events' | 'people' | 'vendors' | 'budget') => {
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

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  return (
    <ProfileProvider>
    <div
      className="min-h-screen bg-white"
      onDragEnter={(e) => { if (hasFiles(e)) { e.preventDefault(); dragDepth.current++; setDragOver(true); } }}
      onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragOver(false); }}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDragOver(false); void filesFromDrop(e.dataTransfer).then(onAppDrop); }}
    >
      {dragOver && (
        <div className="fixed inset-0 z-[100] bg-gray-200/70 border-4 border-dashed border-gray-400 flex items-center justify-center pointer-events-none">
          <span className="text-lg text-gray-700 bg-white/90 px-4 py-2 rounded-full inline-flex items-center gap-2"><Plus className="w-5 h-5" /> Drop a brief, budget, cover, or folder to create an event</span>
        </div>
      )}
      <nav className="bg-white border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <button onClick={() => navTo('home')} className="text-xl mr-8 hover:opacity-70 transition-opacity" title="Home">EventHub</button>
              {/* mr-8 mirrors EventHub's left gap, so an equal buffer is always kept to the
                  right of the menu — even when the window narrows it won't crowd the profile. */}
              <Tabs className="mr-8" value={activePage} onValueChange={(v) => navTo(v as typeof activePage)}>
                {/* Bigger triggers + a thin white divider between each to separate the buttons. */}
                <TabsList className="group-data-horizontal/tabs:h-10 [&_[data-slot=tabs-trigger]]:px-4 [&_[data-slot=tabs-trigger]]:text-base [&_[data-slot=tabs-trigger]:not(:last-child)]:border-r [&_[data-slot=tabs-trigger]:not(:last-child)]:border-r-white">
                  <TabsTrigger value="home"><Home className="w-4 h-4" /> Home</TabsTrigger>
                  <TabsTrigger value="events"><Calendar className="w-4 h-4" /> Events</TabsTrigger>
                  <TabsTrigger value="people"><Users className="w-4 h-4" /> People</TabsTrigger>
                  <TabsTrigger value="vendors"><Briefcase className="w-4 h-4" /> Vendors</TabsTrigger>
                  <TabsTrigger value="budget"><DollarSign className="w-4 h-4" /> Budget</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <ProfileSwitcher />
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {activePage === 'home' && <HomePage onOpenEvent={(id) => openEvent(id, 'home')} onCreateEvent={createEvent} />}
        {activePage === 'events' && (
          <EventsPage
            key={eventsNonce}
            selectedEventId={selectedEventId}
            setSelectedEventId={setSelectedFromEvents}
            onViewPeople={viewPeopleForEvent}
            openCreate={createOnEvents}
            initialFiles={droppedFiles}
            looksPast={droppedLooksPast}
            onFilesConsumed={() => { setDroppedFiles(null); setDroppedLooksPast(false); }}
          />
        )}
        {activePage === 'people' && (
          <PeoplePage
            eventFilter={peopleEventFilter}
            onBack={peopleEventFilter ? backToEvent : undefined}
          />
        )}
        {activePage === 'vendors' && <VendorsPage />}
        {activePage === 'budget' && <BudgetPage onOpenEvent={(id) => openEvent(id, 'budget')} />}
      </div>
    </div>
    </ProfileProvider>
  );
}
