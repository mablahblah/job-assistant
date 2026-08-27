import type { AtsCompany, SettingsService } from "../settings-service";

export interface AtsBoards {
  boards: AtsCompany[];
  warnings: string[];
}

// The boards an ATS collector polls, asked for by platform.
//
// A platform with no boards is a real answer rather than a broken database,
// because emptying a platform's companies is how that platform gets switched
// off. The warning is the only thing that tells a platform switched off on
// purpose from one emptied by accident, so an empty list is never silent.
export async function readAtsBoards(
  settings: SettingsService,
  platform: string
): Promise<AtsBoards> {
  const boards = await settings.getAtsCompanies(platform);
  const warnings =
    boards.length === 0
      ? [`No ${platform} company carries a board slug, so no ${platform} board was polled.`]
      : [];
  return { boards, warnings };
}
