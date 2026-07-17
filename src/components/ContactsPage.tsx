import { useState } from "react";
import { Users, Briefcase } from "lucide-react";
import { PeoplePage } from "./PeoplePage";
import { VendorsPage } from "./VendorsPage";

// People and Vendors are both "contacts" — one tab with a segmented sub-view. Reuses the existing
// pages unchanged; PeoplePage renders unscoped here (no eventFilter).
export function ContactsPage() {
  const [view, setView] = useState<"people" | "vendors">("people");
  return (
    <div>
      <div className="inline-flex rounded-lg border border-border bg-white p-0.5 mb-6">
        {([["people", "People", Users], ["vendors", "Vendors", Briefcase]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setView(k)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${view === k ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>
      {view === "people" ? <PeoplePage /> : <VendorsPage />}
    </div>
  );
}
