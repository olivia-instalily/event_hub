import { useState } from 'react';
import { Calendar, Users, Briefcase } from 'lucide-react';
import { EventsPage } from './components/EventsPage';
import { PeoplePage } from './components/PeoplePage';
import { VendorsPage } from './components/VendorsPage';

export default function Component() {
  const [activePage, setActivePage] = useState<'events' | 'people' | 'vendors'>('events');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-8">
            <h1 className="text-xl mr-8">Dashboard</h1>
            <div className="flex gap-2">
              <button
                onClick={() => setActivePage('events')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  activePage === 'events'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Calendar className="w-4 h-4" />
                Events
              </button>
              <button
                onClick={() => setActivePage('people')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  activePage === 'people'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Users className="w-4 h-4" />
                People
              </button>
              <button
                onClick={() => setActivePage('vendors')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  activePage === 'vendors'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Briefcase className="w-4 h-4" />
                Vendors
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Page Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {activePage === 'events' && <EventsPage />}
        {activePage === 'people' && <PeoplePage />}
        {activePage === 'vendors' && <VendorsPage />}
      </div>
    </div>
  );
}
