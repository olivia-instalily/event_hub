// Budget category matching: map synonyms to a canonical label so a dropped breakdown's
// "A/V" or "audio visual" lands on the same row as the projected "A/V" category, etc.
const SYNONYMS: { rx: RegExp; canonical: string }[] = [
  { rx: /\b(a\/?v|audio[\s/-]*visual|audiovisual|sound|projector|staging)\b/i, canonical: "A/V" },
  { rx: /\b(venue|space|location|hall|room rental)\b/i, canonical: "Venue" },
  { rx: /\b(cater|catering|food|f\s*&\s*b|menu|beverage|drinks?|bar)\b/i, canonical: "Catering" },
  { rx: /\b(photo|photography|video|videograph|content capture)\b/i, canonical: "Photography/Video" },
  { rx: /\b(market|marketing|promo|promotion|advertis|social|comms)\b/i, canonical: "Marketing" },
  { rx: /\b(decor|floral|flowers?|furnitur|rentals?)\b/i, canonical: "Decor & Rentals" },
  { rx: /\b(staff|staffing|labor|labour|personnel)\b/i, canonical: "Staffing" },
  { rx: /\b(travel|transport|transportation|lodging|hotel|flights?)\b/i, canonical: "Travel" },
  { rx: /\b(swag|gifts?|merch|merchandise|giveaways?)\b/i, canonical: "Swag & Gifts" },
  { rx: /\b(print|printing|signage|collateral|name ?tags?)\b/i, canonical: "Printing & Signage" },
];

/** A display-friendly canonical category name (or the trimmed input when no synonym matches). */
export function canonicalCategory(label: string): string {
  const hit = SYNONYMS.find((s) => s.rx.test(label));
  return hit ? hit.canonical : label.trim();
}

/** A normalized key for matching two category labels (fuzzy: A/V == audio visual). */
export function categoryKey(label: string): string {
  return canonicalCategory(label).toLowerCase();
}
