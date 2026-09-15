import type { AtsSlugService } from "../services/ats-slug-service";

// A board an ATS collector polls. The slug is the whole identity: the three
// ATS collectors poll by slug, so a company name here would have no reader.
export interface AtsBoard {
  ats_slug: string;
}

export interface AtsBoards {
  boards: AtsBoard[];
  warnings: string[];
}

// The boards one ATS collector polls, asked for by the collector's own name.
//
// The list lives in the ATS slug table, where a row carrying a collector is
// one we poll every run and a row carrying none is only a board we know a
// company posts on. That separation is why the lookup is a service of its own
// rather than a query over the company table.
//
// A collector with no boards is a real answer rather than a broken database,
// because emptying a collector's list is how that collector gets switched
// off. The warning is the only thing that tells a collector switched off on
// purpose from one emptied by accident, so an empty list is never silent.
export async function readAtsBoards(
  atsSlugs: AtsSlugService,
  collector: string
): Promise<AtsBoards> {
  const rows = await atsSlugs.listForCollector(collector);
  const boards = rows.map((row) => ({ ats_slug: row.slug }));
  const warnings =
    boards.length === 0
      ? [`No ${collector} board is on a polling list, so no ${collector} board was polled.`]
      : [];
  return { boards, warnings };
}
