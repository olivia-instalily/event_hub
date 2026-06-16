// Tag colors, shared by the card and detail/planning pages so a tag's color is
// consistent everywhere. The six preset tags have fixed colors; any other tag
// (custom/created) is hashed to a stable palette color — never gray — so created
// tags look first-class wherever they appear.

// The fixed event-tag taxonomy: a few categories, one color per category (pinned in PRESET below).
export interface TagCategory { name: string; tags: string[] }
export const TAG_CATEGORIES: TagCategory[] = [
  { name: 'Hosted', tags: ['Client summit', 'Brand & community event', 'Co-hosted partner event', 'Hackathon'] },
  { name: 'Sponsorship', tags: ['Sponsorship'] },
  { name: 'Internal', tags: ['Internal team social', 'Company milestone'] },
];
export const EVENT_TAGS = TAG_CATEGORIES.flatMap((c) => c.tags);
export type EventTag = string;

// Full literal class strings so Tailwind's scanner keeps them.
interface Hue { color: string; ring: string; hover: string; }
const PALETTE: Hue[] = [
  { color: 'bg-orange-100 text-orange-700', ring: 'ring-orange-400', hover: 'hover:ring-1 hover:ring-orange-700' },
  { color: 'bg-purple-100 text-purple-700', ring: 'ring-purple-400', hover: 'hover:ring-1 hover:ring-purple-700' },
  { color: 'bg-green-100 text-green-700', ring: 'ring-green-400', hover: 'hover:ring-1 hover:ring-green-700' },
  { color: 'bg-blue-100 text-blue-700', ring: 'ring-blue-400', hover: 'hover:ring-1 hover:ring-blue-700' },
  { color: 'bg-teal-100 text-teal-700', ring: 'ring-teal-400', hover: 'hover:ring-1 hover:ring-teal-700' },
  { color: 'bg-pink-100 text-pink-700', ring: 'ring-pink-400', hover: 'hover:ring-1 hover:ring-pink-700' },
  { color: 'bg-rose-100 text-rose-700', ring: 'ring-rose-400', hover: 'hover:ring-1 hover:ring-rose-700' },
  { color: 'bg-amber-100 text-amber-700', ring: 'ring-amber-400', hover: 'hover:ring-1 hover:ring-amber-700' },
  { color: 'bg-lime-100 text-lime-700', ring: 'ring-lime-400', hover: 'hover:ring-1 hover:ring-lime-700' },
  { color: 'bg-cyan-100 text-cyan-700', ring: 'ring-cyan-400', hover: 'hover:ring-1 hover:ring-cyan-700' },
  { color: 'bg-indigo-100 text-indigo-700', ring: 'ring-indigo-400', hover: 'hover:ring-1 hover:ring-indigo-700' },
  { color: 'bg-fuchsia-100 text-fuchsia-700', ring: 'ring-fuchsia-400', hover: 'hover:ring-1 hover:ring-fuchsia-700' },
  { color: 'bg-sky-100 text-sky-700', ring: 'ring-sky-400', hover: 'hover:ring-1 hover:ring-sky-700' },
  { color: 'bg-violet-100 text-violet-700', ring: 'ring-violet-400', hover: 'hover:ring-1 hover:ring-violet-700' },
  { color: 'bg-emerald-100 text-emerald-700', ring: 'ring-emerald-400', hover: 'hover:ring-1 hover:ring-emerald-700' },
];

// Each taxonomy tag pinned to its category's hue (index into PALETTE) so a whole category
// shares one color. Non-taxonomy strings (vendor categories, people tags) still hash below.
const PRESET: Record<string, number> = {
  // Hosted → green
  'Client summit': 2, 'Brand & community event': 2, 'Co-hosted partner event': 2, Hackathon: 2,
  // Sponsorship → amber
  Sponsorship: 7,
  // Internal → purple
  'Internal team social': 1, 'Company milestone': 1,
};

function hueFor(tag: string | null | undefined): Hue {
  if (!tag) return { color: 'bg-gray-100 text-gray-600', ring: 'ring-gray-300', hover: 'hover:ring-1 hover:ring-gray-400' };
  if (tag in PRESET) return PALETTE[PRESET[tag]];
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function tagColor(tag: string | null | undefined): string {
  return hueFor(tag).color;
}
// Ring color for the inner outline on stat tiles, matched to the tag.
export function tagRing(tag: string | null | undefined): string {
  return hueFor(tag).ring;
}
// On hover, a tag's outline takes its letter color (the -700 shade).
export function tagHoverRing(tag: string | null | undefined): string {
  return hueFor(tag).hover;
}
