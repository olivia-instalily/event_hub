// Build a CSV from an array of flat objects and trigger a browser download.
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  const csv = [cols.join(","), body].filter(Boolean).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
