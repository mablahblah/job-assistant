// Never prerender — this page queries the live DB on every request
export const dynamic = "force-dynamic";

import { getWorkSearchEntries } from "@/app/actions";
import { generateWeekSlots, getWeekStart } from "@/lib/work-search-weeks";
import WorkLogView from "@/components/WorkLogView";

export default async function WorkLogPage() {
  const entries = await getWorkSearchEntries();

  // Determine the full date range: current week down to earliest entry
  const now = new Date();
  const earliest = entries.length > 0
    ? new Date(entries[entries.length - 1].date) // entries sorted desc, so last = oldest
    : now;

  // Generate all week slots (most recent first) so empty weeks render too
  const weekSlots = generateWeekSlots(getWeekStart(earliest), now);

  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      <WorkLogView entries={entries} weekSlots={weekSlots.map((d) => d.toISOString())} />
    </main>
  );
}
