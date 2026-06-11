import { Calendar, MapPin, Users, ArrowLeft, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { useState } from "react";

interface EventDetailPageProps {
  eventId: number;
  onBack: () => void;
}

export function EventDetailPage({ eventId, onBack }: EventDetailPageProps) {
  // Mock event data - in a real app, this would be fetched based on eventId
  const event = {
    id: eventId,
    title: "Tech Summit 2026",
    category: "Conference",
    categoryColor: "bg-orange-100 text-orange-700",
    eventType: "In-person",
    location: "San Francisco, CA",
    date: "June 15, 2026",
    owner: "Sarah Chen",
    attendeeCount: 45,
    description: "Annual technology conference bringing together industry leaders and innovators.",
    status: "future",
    overallProgress: 35, // percentage
  };

  const [phases] = useState([
    {
      id: 0,
      title: "Planning & Setup",
      description: "Initial planning and vendor securing",
      progress: 80,
      checkpoints: [
        { id: 1, task: "Secure venue", completed: true, dueDate: "May 1, 2026", assignee: "Sarah Chen" },
        { id: 2, task: "Book catering vendor", completed: true, dueDate: "May 5, 2026", assignee: "Michael Rodriguez" },
        { id: 3, task: "Confirm AV equipment", completed: true, dueDate: "May 10, 2026", assignee: "Emily Watson" },
        { id: 4, task: "Finalize speaker lineup", completed: false, dueDate: "May 20, 2026", assignee: "Sarah Chen" },
      ]
    },
    {
      id: 1,
      title: "Marketing & Registration",
      description: "Promotion and attendee registration",
      progress: 45,
      checkpoints: [
        { id: 5, task: "Launch registration page", completed: true, dueDate: "May 15, 2026", assignee: "Alex Thompson" },
        { id: 6, task: "Send promotional emails", completed: true, dueDate: "May 18, 2026", assignee: "Jennifer Lee" },
        { id: 7, task: "Social media campaign", completed: false, dueDate: "June 1, 2026", assignee: "Alex Thompson" },
        { id: 8, task: "Partner outreach", completed: false, dueDate: "June 5, 2026", assignee: "David Kim" },
      ]
    },
    {
      id: 2,
      title: "Week-Of Preparations",
      description: "Final preparations before event day",
      progress: 0,
      checkpoints: [
        { id: 9, task: "Venue walkthrough", completed: false, dueDate: "June 10, 2026", assignee: "Sarah Chen" },
        { id: 10, task: "Brief all staff", completed: false, dueDate: "June 12, 2026", assignee: "Emily Watson" },
        { id: 11, task: "Confirm vendor arrivals", completed: false, dueDate: "June 13, 2026", assignee: "Michael Rodriguez" },
        { id: 12, task: "Print materials ready", completed: false, dueDate: "June 14, 2026", assignee: "Jennifer Lee" },
      ]
    },
  ]);

  const [lessons] = useState([
    {
      id: 1,
      event: "Winter Summit 2025",
      category: "Venue",
      lesson: "Book larger breakout rooms - attendees prefer smaller discussion groups",
      impact: "high"
    },
    {
      id: 2,
      event: "Spring Tech Conference 2026",
      category: "Catering",
      lesson: "Offer more vegetarian/vegan options - 40% of attendees requested this",
      impact: "medium"
    },
    {
      id: 3,
      event: "Winter Summit 2025",
      category: "Technology",
      lesson: "Have backup WiFi hotspots ready - main network had issues during peak hours",
      impact: "high"
    },
    {
      id: 4,
      event: "Spring Tech Conference 2026",
      category: "Registration",
      lesson: "Enable mobile check-in to reduce wait times at registration desk",
      impact: "medium"
    },
  ]);

  const [budget] = useState({
    totalBudget: 50000,
    budgetFromPastEvents: 48500, // Average from similar events
    categories: [
      { name: "Venue", budgeted: 15000, actual: 14500, confirmed: true },
      { name: "Catering", budgeted: 12000, actual: 0, confirmed: false },
      { name: "Audio/Visual", budgeted: 8000, actual: 7800, confirmed: true },
      { name: "Marketing", budgeted: 6000, actual: 3200, confirmed: false },
      { name: "Speakers", budgeted: 5000, actual: 0, confirmed: false },
      { name: "Materials & Swag", budgeted: 4000, actual: 0, confirmed: false },
    ]
  });

  const totalActual = budget.categories.reduce((sum, cat) => sum + cat.actual, 0);
  const totalBudgeted = budget.categories.reduce((sum, cat) => sum + cat.budgeted, 0);
  const budgetUsedPercentage = (totalActual / totalBudgeted) * 100;

  const toggleCheckpoint = (phaseId: number, checkpointId: number) => {
    // In a real app, this would update the backend
    console.log(`Toggle checkpoint ${checkpointId} in phase ${phaseId}`);
  };

  return (
    <div>
      {/* Back Button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
        Back to Events
      </button>

      {/* Event Header */}
      <div className="bg-white rounded-2xl border border-gray-200 p-8 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className={`inline-block px-3 py-1 rounded-full text-sm ${event.categoryColor} mb-3`}>
              {event.category}
            </span>
            <h1 className="text-3xl mb-2">{event.title}</h1>
            <p className="text-gray-600 mb-4">{event.description}</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-6 mb-6">
          <div className="flex items-center gap-2 text-gray-600">
            <Calendar className="w-5 h-5" />
            <span>{event.date}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <MapPin className="w-5 h-5" />
            <span>{event.location}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Users className="w-5 h-5" />
            <span>{event.attendeeCount} attendees</span>
          </div>
          <div className="text-gray-600">
            <span className="font-medium">Owner:</span> {event.owner}
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Progress</span>
            <span className="text-sm text-gray-600">{event.overallProgress}% Complete</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all"
              style={{ width: `${event.overallProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Phases with Checkpoints */}
      <div className="mb-6">
        <h2 className="text-2xl mb-4">Project Phases</h2>
        <div className="space-y-6">
          {phases.map((phase) => (
            <div key={phase.id} className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xl">Phase {phase.id}: {phase.title}</h3>
                  <p className="text-gray-600 text-sm">{phase.description}</p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-600 mb-1">{phase.progress}% Complete</div>
                  <div className="w-32 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${phase.progress}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Checkpoint Table */}
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-sm text-gray-600 w-12"></th>
                      <th className="text-left px-4 py-3 text-sm text-gray-600">Task</th>
                      <th className="text-left px-4 py-3 text-sm text-gray-600">Due Date</th>
                      <th className="text-left px-4 py-3 text-sm text-gray-600">Assignee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phase.checkpoints.map((checkpoint) => (
                      <tr key={checkpoint.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleCheckpoint(phase.id, checkpoint.id)}
                            className="hover:scale-110 transition-transform"
                          >
                            {checkpoint.completed ? (
                              <CheckCircle2 className="w-5 h-5 text-green-500" />
                            ) : (
                              <Circle className="w-5 h-5 text-gray-300" />
                            )}
                          </button>
                        </td>
                        <td className={`px-4 py-3 ${checkpoint.completed ? 'line-through text-gray-400' : ''}`}>
                          {checkpoint.task}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{checkpoint.dueDate}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{checkpoint.assignee}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lessons from Previous Events */}
      <div className="mb-6">
        <h2 className="text-2xl mb-4">Lessons from Previous Events</h2>
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Source Event</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Category</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Lesson Learned</th>
                <th className="text-left px-6 py-3 text-sm text-gray-600">Impact</th>
              </tr>
            </thead>
            <tbody>
              {lessons.map((lesson) => (
                <tr key={lesson.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm">{lesson.event}</td>
                  <td className="px-6 py-4">
                    <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                      {lesson.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">{lesson.lesson}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-block px-3 py-1 rounded-full text-sm ${
                      lesson.impact === 'high' 
                        ? 'bg-red-100 text-red-700' 
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {lesson.impact === 'high' ? 'High' : 'Medium'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Budget & Expenses */}
      <div>
        <h2 className="text-2xl mb-4">Budget & Expenses</h2>
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          {/* Budget Summary */}
          <div className="grid grid-cols-3 gap-6 mb-6 pb-6 border-b border-gray-200">
            <div>
              <p className="text-gray-600 text-sm mb-1">Total Budget</p>
              <p className="text-2xl">${totalBudgeted.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-600 text-sm mb-1">Actual Spend</p>
              <p className="text-2xl text-blue-600">${totalActual.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-600 text-sm mb-1">Remaining</p>
              <p className="text-2xl text-green-600">${(totalBudgeted - totalActual).toLocaleString()}</p>
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Budget Used</span>
              <span className="text-sm text-gray-600">{budgetUsedPercentage.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${
                  budgetUsedPercentage > 90 ? 'bg-red-500' : budgetUsedPercentage > 70 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${budgetUsedPercentage}%` }}
              />
            </div>
          </div>

          <p className="text-sm text-gray-600 mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Budget baseline: ${budget.budgetFromPastEvents.toLocaleString()} (avg. from similar past events)
          </p>

          {/* Expense Tracker Table */}
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-sm text-gray-600">Category</th>
                  <th className="text-right px-4 py-3 text-sm text-gray-600">Budgeted</th>
                  <th className="text-right px-4 py-3 text-sm text-gray-600">Actual</th>
                  <th className="text-right px-4 py-3 text-sm text-gray-600">Difference</th>
                  <th className="text-center px-4 py-3 text-sm text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {budget.categories.map((category, index) => {
                  const difference = category.budgeted - category.actual;
                  const isOverBudget = difference < 0;
                  
                  return (
                    <tr key={index} className="border-b border-gray-100">
                      <td className="px-4 py-3 font-medium">{category.name}</td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        ${category.budgeted.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {category.actual > 0 ? `$${category.actual.toLocaleString()}` : '-'}
                      </td>
                      <td className={`px-4 py-3 text-right ${
                        category.actual === 0 ? 'text-gray-400' :
                        isOverBudget ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {category.actual > 0 
                          ? `${isOverBudget ? '-' : '+'}$${Math.abs(difference).toLocaleString()}`
                          : '-'
                        }
                      </td>
                      <td className="px-4 py-3 text-center">
                        {category.confirmed ? (
                          <span className="inline-block px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">
                            Confirmed
                          </span>
                        ) : (
                          <span className="inline-block px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm">
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                <tr>
                  <td className="px-4 py-3 font-bold">Total</td>
                  <td className="px-4 py-3 text-right font-bold">
                    ${totalBudgeted.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-bold">
                    ${totalActual.toLocaleString()}
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${
                    totalBudgeted - totalActual < 0 ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {totalBudgeted - totalActual < 0 ? '-' : '+'}
                    ${Math.abs(totalBudgeted - totalActual).toLocaleString()}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
