// Every value on the dashboard comes out of the database, and the page is built
// in one pass. One unescaped quotation mark inside a tooltip attribute breaks
// the rest of the row. This takes an absent value because nearly every column
// the page reads can be empty.
export function escapeHtml(value: string | null | undefined): string {
  if (value == null) return "";

  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
