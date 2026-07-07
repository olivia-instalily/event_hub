// Multi-tab workbooks (.xlsx/.xls/.ods) can't be read as text — parse them with SheetJS and
// turn each tab into its own CSV blob so the existing per-drop router can handle each one.
import * as XLSX from "xlsx";

export interface Sheet { name: string; csv: string }

/** One CSV blob per NON-EMPTY tab, in workbook order. */
export async function readWorkbook(file: File): Promise<Sheet[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheets: Sheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws).trim();
    if (csv) sheets.push({ name, csv });
  }
  return sheets;
}

/** All tabs joined into one labeled text blob — for consumers that want plain text (the LLM path). */
export async function readWorkbookAsText(file: File): Promise<string> {
  return (await readWorkbook(file)).map((s) => `# ${s.name}\n${s.csv}`).join("\n\n");
}
