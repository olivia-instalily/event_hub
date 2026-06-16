// A pragmatic list of common event cities for location autocomplete (no geocoding API).
// Typing suggests these; on commit the input "locks" to a matching city's canonical name.
export const CITIES = [
  'New York, NY', 'San Francisco, CA', 'Los Angeles, CA', 'Chicago, IL', 'Boston, MA',
  'Seattle, WA', 'Austin, TX', 'Denver, CO', 'Washington, DC', 'Atlanta, GA',
  'Miami, FL', 'Dallas, TX', 'Houston, TX', 'San Diego, CA', 'Philadelphia, PA',
  'Portland, OR', 'Nashville, TN', 'Minneapolis, MN', 'Phoenix, AZ', 'Detroit, MI',
  'Toronto, ON', 'Vancouver, BC', 'Montreal, QC', 'London, UK', 'Paris, FR',
  'Berlin, DE', 'Munich, DE', 'Amsterdam, NL', 'Dublin, IE', 'Madrid, ES',
  'Barcelona, ES', 'Lisbon, PT', 'Stockholm, SE', 'Zurich, CH', 'Milan, IT',
  'Tel Aviv, IL', 'Dubai, AE', 'Singapore', 'Hong Kong', 'Tokyo, JP',
  'Sydney, AU', 'Melbourne, AU', 'Bangalore, IN', 'Mumbai, IN', 'São Paulo, BR',
  'Mexico City, MX',
];

// Common shorthands / bare-name inputs that should lock to a canonical city.
const ALIASES: Record<string, string> = {
  nyc: 'New York, NY', 'new york': 'New York, NY', 'new york city': 'New York, NY', manhattan: 'New York, NY',
  sf: 'San Francisco, CA', 'san francisco': 'San Francisco, CA', 'the bay': 'San Francisco, CA',
  la: 'Los Angeles, CA', 'los angeles': 'Los Angeles, CA',
  dc: 'Washington, DC', 'washington dc': 'Washington, DC', washington: 'Washington, DC',
  philly: 'Philadelphia, PA', vegas: 'Las Vegas, NV',
};

/**
 * Snap a typed value to a known city ("location lock"): exact match → alias →
 * city-name (before the comma) → prefix match. Falls back to the trimmed input
 * when nothing matches, so unlisted places are still allowed.
 */
export function canonicalCity(input: string): string {
  const v = input.trim();
  if (!v) return v;
  const lc = v.toLowerCase();
  if (ALIASES[lc]) return ALIASES[lc];
  const cityName = (c: string) => c.split(',')[0].toLowerCase();
  return (
    CITIES.find((c) => c.toLowerCase() === lc) ??
    CITIES.find((c) => cityName(c) === lc) ??
    CITIES.find((c) => c.toLowerCase().startsWith(lc) || cityName(c).startsWith(lc)) ??
    v
  );
}
