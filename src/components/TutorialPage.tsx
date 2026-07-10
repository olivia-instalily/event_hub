import { HelpCircle, PlayCircle } from "lucide-react";

// Walk-through videos for EventHub. Add entries here as you record them — each renders as a card
// with an embedded player. `embedUrl` is the EMBED url (Loom: https://www.loom.com/embed/<id>;
// YouTube: https://www.youtube.com/embed/<id>). Order top-to-bottom = the order shown.
type Tutorial = { title: string; description?: string; embedUrl: string };

const TUTORIALS: Tutorial[] = [
  // { title: "Creating an event from a brief", description: "Drop a folder → review → create.", embedUrl: "https://www.loom.com/embed/XXXXXXXX" },
];

export function TutorialPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <HelpCircle className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl">Tutorials</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">Short walk-throughs of how to use EventHub.</p>

      {TUTORIALS.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 py-16 flex flex-col items-center justify-center text-center">
          <PlayCircle className="w-8 h-8 text-gray-300 mb-3" />
          <p className="text-gray-600 font-medium">Walk-through videos coming soon</p>
          <p className="text-sm text-gray-400 mt-1">They'll show up here as they're recorded.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {TUTORIALS.map((t) => (
            <section key={t.title}>
              <h2 className="text-lg font-medium">{t.title}</h2>
              {t.description && <p className="text-sm text-gray-500 mb-2">{t.description}</p>}
              <div className="mt-2 aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
                <iframe
                  src={t.embedUrl}
                  title={t.title}
                  className="w-full h-full"
                  allowFullScreen
                  allow="fullscreen; picture-in-picture"
                />
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
