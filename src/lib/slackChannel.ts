// Slack channel name from an event title: lowercase, [a-z0-9-] only, evt- prefixed, <=80 chars.
export function slugifyChannel(title: string): string {
  const body = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")  // drop anything that isn't alphanumeric / space / hyphen (incl. non-ascii)
    .replace(/[\s-]+/g, "-")        // runs of space/hyphen → single hyphen
    .replace(/^-|-$/g, "");         // trim edge hyphens
  const slug = body || "event";
  return `evt-${slug}`.slice(0, 80).replace(/-$/, "");
}
