// Browser-side text extraction for uploaded project files.
const TEXT_EXT = /\.(txt|md|json|csv|xml|ya?ml|toml|html?|css|scss|js|jsx|ts|tsx|py|java|kt|go|rs|rb|php|c|cc|cpp|h|hpp|cs|swift|sql|sh|env|ini|vue|svelte|dart)$/i;
const SKIP = /(node_modules|\.git\/|dist\/|build\/|\.next\/|\.lock$|lock\.json$)/;
const LIMIT = 200_000;

export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    const { extractText: pdf, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await pdf(doc, { mergePages: true });
    return String(text).slice(0, LIMIT);
  }
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return r.value.slice(0, LIMIT);
  }
  if (name.endsWith(".zip")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    let out = "";
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir || SKIP.test(path) || !TEXT_EXT.test(path)) continue;
      if (out.length > LIMIT) break;
      const c = await entry.async("string");
      out += `\n--- ${path} ---\n${c.slice(0, 30_000)}\n`;
    }
    return out.slice(0, LIMIT);
  }
  if (file.type.startsWith("image/")) {
    return `[صورة مرفقة: ${file.name}]`;
  }
  return (await file.text()).slice(0, LIMIT);
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadCodeZip(filename: string, content: string) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const re = /###\s*FILE:\s*(.+)\n+```[^\n]*\n([\s\S]*?)```/g;
  let m;
  let n = 0;
  while ((m = re.exec(content))) {
    zip.file((m[1] ?? "file").trim(), m[2] ?? "");
    n++;
  }
  if (!n) zip.file("output.md", content);
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.md$/, "") + ".zip";
  a.click();
  URL.revokeObjectURL(url);
}
