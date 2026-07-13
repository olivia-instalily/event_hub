import { useEffect, useRef, useState } from 'react';
import { Home, Calendar, CalendarDays, Users, Briefcase, DollarSign, Plus, AlertCircle } from 'lucide-react';
import { filesFromDrop } from './lib/drop';
import { looksLikeBackfill } from './lib/backfill';
import { parseDeepLink, setPendingScopingBudget } from './lib/deepLink';
import { EventsPage, CreateEventModal, classifyDropFile } from './components/EventsPage';
import { BackfillModal } from './components/BackfillModal';
import { listEvents, type EventListItem } from './lib/db';
import { HomePage } from './components/HomePage';
import { PeoplePage } from './components/PeoplePage';
import { VendorsPage } from './components/VendorsPage';
import { BudgetPage } from './components/BudgetPage';
import { TutorialPage } from './components/TutorialPage';
import { PeopleAdminPage } from './components/PeopleAdminPage';
import { CalendarPage } from './components/CalendarPage';
import { ProfileProvider } from './lib/profile';
import { ProfileSwitcher } from './components/ProfileSwitcher';
import { Tabs, TabsList, TabsTrigger } from '@instalily/ui/tabs';
import { useAuth } from './lib/auth';
import { LoginScreen } from './components/LoginScreen';
import { proxiedBackend } from './lib/supabase';

export type PeopleStatusFilter = 'all' | 'registered' | 'checkedIn' | 'waitlisted' | 'speakers';
export type EventFilter = { id: string; name: string; tag?: string | null; status?: PeopleStatusFilter };

export default function Component() {
  // Deep link from a Slack scoping request (?event=<id>&view=budget) — resolved once on load so
  // a cold click lands on that event. Parsed synchronously here so the initial nav state below
  // opens straight to the event (no flash of Home first).
  const { status: authStatus, user: authUser } = useAuth();
  const [deepLink] = useState(() => (typeof window !== 'undefined' ? parseDeepLink(window.location.search) : null));
  const [activePage, setActivePage] = useState<'home' | 'events' | 'people' | 'vendors' | 'budget' | 'calendar' | 'tutorial' | 'admin'>(deepLink ? 'events' : 'home');
  // Lifted so navigation can leave the Events page and return to the same event detail.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(deepLink?.eventId ?? null);
  // When set (and on the People page), People is scoped to this event with a Back button.
  const [peopleEventFilter, setPeopleEventFilter] = useState<EventFilter | null>(null);
  // Bumped on home/Events nav so EventsPage remounts and resets its filters.
  const [eventsNonce, setEventsNonce] = useState(0);
  // Which page an open event was launched from, so its Back button returns there
  // (e.g. a Home todo → Back to Home, a Budget row → Back to Budget).
  type Page = 'home' | 'events' | 'people' | 'vendors' | 'budget' | 'calendar';
  const [eventOrigin, setEventOrigin] = useState<Page>('events');
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  // Create-event flow, hosted at the app root so it overlays whatever page you're on. Dropping a
  // file (or hitting a "Create Event" button) opens the modal over the current page — the background
  // never switches to Events mid-drop. events feeds the modal's dedup + template matching.
  const [createOpen, setCreateOpen] = useState(false);
  const [createFiles, setCreateFiles] = useState<File[] | null>(null);
  const [createAsTemplate, setCreateAsTemplate] = useState(false); // drop chooser "Template only" → force template mode
  const [pastChooserFiles, setPastChooserFiles] = useState<File[] | null>(null);
  const [backfill, setBackfill] = useState<{ text?: string; files: File[] | null } | null>(null);
  const [modalEvents, setModalEvents] = useState<EventListItem[]>([]);
  const loadModalEvents = async () => { try { setModalEvents(await listEvents()); } catch { setModalEvents([]); } };
  const onAppDrop = async (files: File[]) => {
    if (!files.length) return;
    // Light sniff: a dropped debrief/recap is a BACKFILL, not a create. If it looks past, hand
    // EventsPage a flag so it asks (past vs in-process) instead of barreling into the create flow.
    // Read EVERY text-like file, not just the first — on a folder drop the brief (which carries the
    // date) may sort after an attendee/budget file, and a future date in ANY file means "not a
    // backfill". Combining the texts lets looksLikeBackfill see that date regardless of ordering.
    let suspect = false;
    try {
      const texty = files.filter((f) => /text|json|csv|markdown|plain/i.test(f.type) || /\.(txt|md|vtt|srt|csv|json)$/i.test(f.name));
      const texts = await Promise.all((texty.length ? texty : files.slice(0, 1)).map((f) => f.text().catch(() => '')));
      suspect = looksLikeBackfill(texts.join('\n\n'));
    } catch { /* unreadable — treat as create */ }
    await loadModalEvents();
    // Open the flow as an overlay on the CURRENT page — no setActivePage, so the background you
    // dropped onto (Home, Budget, …) stays put. suspect → ask backfill-vs-create first.
    if (suspect) setPastChooserFiles(files);
    else { setCreateAsTemplate(false); setCreateFiles(files); setCreateOpen(true); }
  };
  // "Looks like ___" chooser resolution for a drop that reads like a past event or a playbook.
  const chooseInProcess = () => { const f = pastChooserFiles; setPastChooserFiles(null); setCreateAsTemplate(false); setCreateFiles(f); setCreateOpen(true); };
  const chooseTemplate = () => { const f = pastChooserFiles; setPastChooserFiles(null); setCreateAsTemplate(true); setCreateFiles(f); setCreateOpen(true); };
  const chooseBackfill = async () => {
    const files = pastChooserFiles ?? []; setPastChooserFiles(null);
    const c = await Promise.all(files.map(classifyDropFile));
    const text = c.find((x) => x.kind === 'brief')?.text ?? (await files[0]?.text().catch(() => '')) ?? '';
    setBackfill({ text: text || undefined, files: files.length ? files : null });
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

  const navTo = (page: 'home' | 'events' | 'people' | 'vendors' | 'budget' | 'calendar' | 'tutorial' | 'admin') => {
    setActivePage(page);
    setPeopleEventFilter(null); // manual nav = unscoped
    if (page === 'events') {
      setSelectedEventId(null); // Events tab returns to the list
      setEventsNonce((n) => n + 1); // remount EventsPage so it resets to "All"
    }
  };

  // "Create Event" from anywhere (e.g. Home): open the modal over the current page — no page switch,
  // so the background stays where you were. Navigation to the new event happens only on create.
  const createEvent = async () => {
    await loadModalEvents();
    setCreateAsTemplate(false);
    setCreateFiles(null);
    setCreateOpen(true);
  };

  // Background Luma sync — fire and forget on mount. The user never waits for it and never sees
  // an error: if it fails, existing data is still shown. Caddy strips /functions/v1, so that
  // prefix is required (a bare /functions/luma-sync would 404). The function itself throttles, so
  // firing on every mount is cheap.
  useEffect(() => {
    fetch('/functions/v1/luma-sync', { method: 'POST' }).catch(() => {});
  }, []);

  // Finish resolving the deep link after mount: register the "open the scoping/budget form"
  // intent (the event's Overview consumes it once it mounts, after its data loads), then strip
  // the params so a later refresh or revisit doesn't re-open the form. Nav state above already
  // opened the event; clearing the URL doesn't touch it.
  useEffect(() => {
    if (!deepLink) return;
    if (deepLink.view === 'budget') setPendingScopingBudget(deepLink.eventId);
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
  }, [deepLink]);

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  if (authStatus === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;
  }
  if (authStatus === 'unauthed') {
    return <LoginScreen />;
  }

  return (
    <ProfileProvider forcedProfileId={proxiedBackend ? (authUser?.profileId || null) : null}>
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
                  <TabsTrigger value="calendar" title="Calendar" aria-label="Calendar"><CalendarDays className="w-4 h-4" /></TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <ProfileSwitcher onOpenTutorial={() => setActivePage('tutorial')} onOpenAdmin={() => setActivePage('admin')} />
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
        {activePage === 'calendar' && <CalendarPage onOpenEvent={(id) => openEvent(id, 'calendar')} />}
        {activePage === 'tutorial' && <TutorialPage />}
        {activePage === 'admin' && <PeopleAdminPage />}
      </div>

      {/* Create / backfill flow — hosted here (not inside a page) so it overlays whatever page is
          active. Dropping a file opens this without switching the background page. */}
      {pastChooserFiles && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setPastChooserFiles(null)}>
          <div className="bg-white rounded-2xl border border-border max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1"><AlertCircle className="w-5 h-5 text-amber-600" /><h2 className="text-lg">What should I make from this?</h2></div>
            <p className="text-sm text-gray-600 mb-5">This reads like a past event or a reusable playbook. Pick one — a template is a reusable Event Type with no date, no event created.</p>
            <div className="flex flex-col gap-2">
              <button onClick={chooseBackfill} className="w-full px-3 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-black text-left">Past event — backfill it <span className="text-gray-300">· → wrapped record</span></button>
              <button onClick={chooseInProcess} className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm text-gray-800 hover:bg-gray-50 text-left">Upcoming event — plan it <span className="text-gray-400">· → planning event</span></button>
              <button onClick={chooseTemplate} className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm text-gray-800 hover:bg-gray-50 text-left">Template only — no event <span className="text-gray-400">· → reusable Event Type</span></button>
              <button onClick={() => setPastChooserFiles(null)} className="text-sm text-gray-500 hover:text-gray-800 mt-1">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateEventModal
          events={modalEvents}
          initialFiles={createFiles}
          initialTemplate={createAsTemplate}
          onFilesConsumed={() => setCreateFiles(null)}
          onClose={() => { setCreateOpen(false); setCreateFiles(null); setCreateAsTemplate(false); }}
          onBackfill={(text, files) => { setCreateOpen(false); setCreateFiles(null); setCreateAsTemplate(false); setBackfill({ text, files: files ?? null }); }}
          onCreated={(id) => { setCreateOpen(false); setCreateFiles(null); setCreateAsTemplate(false); openEvent(id, 'events'); }}
        />
      )}

      {backfill && (
        <BackfillModal
          initialText={backfill.text}
          initialFiles={backfill.files}
          onClose={() => setBackfill(null)}
          onCreated={(id) => { setBackfill(null); openEvent(id, 'events'); }}
        />
      )}
    </div>
    </ProfileProvider>
  );
}
