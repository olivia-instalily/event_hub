// Text extraction for dropped PDFs. Loaded on demand (dynamic import) so pdf.js (~1MB) never bloats
// the main bundle. Returns the concatenated text of every page — empty string for a scanned /
// image-only PDF (no text layer), which the caller treats as "couldn't read it".
//
// NOTE: PDFs carry no table structure — text comes out as positioned fragments — so a budget/vendor
// TABLE extracted this way is unreliable. The ingest routes PDF text to the LLM (prose) path and
// nudges the user toward CSV/Markdown for structured budget/vendor data.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function readPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    pages.push(line);
  }
  await task.destroy();
  return pages.join("\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// Heuristic: does this text look like budget/vendor data (a table we'd rather ingest as CSV/MD)?
// Lots of currency figures, or money-adjacent keywords with at least one amount.
export function looksLikeBudgetOrVendor(text: string): boolean {
  const amounts = (text.match(/[$€£]\s?\d[\d,]*(?:\.\d{1,2})?/g) ?? []).length;
  const kw = /\b(budget|invoice|quote|vendor|supplier|catering|venue|a\/?v|rental|deposit|sub-?total|line ?item|cost breakdown|per head)\b/i.test(text);
  return amounts >= 3 || (kw && amounts >= 1);
}
