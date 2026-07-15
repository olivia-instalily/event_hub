// Drops are handled three ways: text (CSV/TSV/TXT/MD), pdf.js (PDF), and SheetJS workbooks
// (.xlsx/.xls/.ods — every tab parsed). Everything else here is an Office/iWork binary that
// comes through file.text() as garbage, so reject it up front with a format-specific hint.
const BINARY_FORMATS: Record<string, string> = {
  ".numbers": "Numbers", // SheetJS Numbers support is unreliable — ask for .xlsx/.csv instead
  ".docx": "Word", ".doc": "Word", ".pages": "Pages",
  ".pptx": "PowerPoint", ".ppt": "PowerPoint", ".key": "Keynote",
};

// Multi-tab workbook formats we parse in full via SheetJS.
const WORKBOOK_EXTS = [".xlsx", ".xls", ".xlsm", ".ods"];

const extOf = (file: File) => (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();

// What we CAN read (for the suggestion line).
const SUGGESTED = ".xlsx, .csv, or .txt";

/** True for a multi-tab workbook we should parse with SheetJS rather than read as text. */
export function isWorkbookFile(file: File): boolean {
  return WORKBOOK_EXTS.includes(extOf(file));
}

/** A user-facing rejection message if the file is a known-unreadable binary format; else null. */
export function unsupportedFileMessage(file: File): string | null {
  const kind = BINARY_FORMATS[extOf(file)];
  if (!kind) return null;
  return `${kind} files (${extOf(file)}) aren't supported — the file can't be read as text. Export it as ${SUGGESTED} format and drop that instead (or paste the rows, or drop a .pdf).`;
}

/** Read a set of dropped files into one labeled text blob — text directly, PDFs via pdf.js,
 *  workbooks via SheetJS. Unreadable binaries are skipped. Used to feed the enrich/backfill review. */
export async function readFilesText(files: File[]): Promise<string> {
  const parts: string[] = [];
  for (const f of files) {
    try {
      let t = "";
      if (isWorkbookFile(f)) t = await (await import("./workbook")).readWorkbookAsText(f);
      else if (/\.pdf$/i.test(f.name) || f.type.includes("pdf")) t = await (await import("./pdfText")).readPdfText(f);
      else if (!unsupportedFileMessage(f)) t = await f.text();
      if (t.trim()) parts.push(`# ${f.name}\n${t}`);
    } catch { /* skip unreadable */ }
  }
  return parts.join("\n\n");
}
