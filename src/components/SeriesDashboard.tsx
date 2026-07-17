export function SeriesDashboard({ seriesId, onBack }: { seriesId: string; onBack: () => void; onOpenEvent?: (id: string) => void }) {
  return <div><button onClick={onBack} className="text-sm text-gray-600">← Series</button><p className="mt-4 text-gray-400">Dashboard for {seriesId} (built next).</p></div>;
}
