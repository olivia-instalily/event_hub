// Collect files from a drag-drop, descending into a dropped folder (entries are captured
// synchronously during the drop, then traversed). Falls back to the flat file list.
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items || []).map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return Array.from(dt.files);
  const out: File[] = [];
  const walk = async (entry: any): Promise<void> => {
    if (entry.isFile) await new Promise<void>((res) => entry.file((f: File) => { out.push(f); res(); }, () => res()));
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = (): Promise<any[]> => new Promise((res) => reader.readEntries((e: any[]) => res(e), () => res([])));
      let batch = await readBatch();
      while (batch.length) { for (const e of batch) await walk(e); batch = await readBatch(); }
    }
  };
  for (const e of entries) await walk(e);
  return out.length ? out : Array.from(dt.files);
}
