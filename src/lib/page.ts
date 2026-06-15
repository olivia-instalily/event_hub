// The ONLY event columns that may be seeded into an ejected (dev-owned) page —
// the World/public field allowlist. The eject snapshot selects exactly these, so
// sensitive data (budget, vendors, candidates, engagements, deliverables,
// attendees, notes) can never reach ejected source by construction.
export const PAGE_PUBLIC_FIELDS = [
  "name",
  "event_date",
  "location",
  "tags",
  "description",
  "format",
  "audience",
  "cover_image_url",
  "luma_url",
] as const;
