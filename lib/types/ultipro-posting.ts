// The shapes UltiPro hands back, as read by both the UltiPro collector and
// the shared field mapping in lib/utils/ultipro-fields.ts. Only the fields
// either reader uses are named.

// A board is named by two values: the company code and the board id.
export interface UltiproBoardParts {
  companyCode: string;
  boardId: string;
}

export interface UltiproLocation {
  LocalizedName?: string;
  Address?: {
    City?: string;
    State?: { Code?: string; Name?: string };
    Country?: { Code?: string; Name?: string };
  };
}

export interface UltiproPosting {
  Id: string;
  Title: string;
  Description?: string;
  PostedDate: string;
  UpdatedDate?: string;
  Locations?: UltiproLocation[];
}

export interface UltiproJobListResponse {
  opportunities?: UltiproPosting[];
  totalCount?: number;
}
