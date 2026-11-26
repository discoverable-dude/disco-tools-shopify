/**
 * Shape of the data Discoverable Tools returns for a store's dashboard (search, ads, rankings).
 * Every section is optional so the platform can add them as each data source is connected.
 */
export type PlatformInsights = {
  period?: { from: string; to: string };
  updatedAt?: string;
  organic?: {
    clicks: number;
    impressions: number;
    ctr?: number;
    position?: number;
    previous?: { clicks: number; impressions: number };
    daily?: { date: string; clicks: number; impressions?: number }[];
    topQueries?: { query: string; clicks: number; impressions?: number; position?: number }[];
    topPages?: { url: string; clicks: number }[];
  };
  paid?: {
    spend: number;
    revenue?: number;
    roas?: number;
    clicks?: number;
    currency?: string;
    previous?: { spend: number; revenue?: number };
    daily?: { date: string; spend: number; revenue?: number }[];
  };
  /** Website traffic (Google Analytics): sessions by channel and new vs returning visitors. */
  traffic?: {
    sessions?: number;
    newUsers?: number;
    returningUsers?: number;
    conversionRate?: number;
    previous?: { sessions: number };
    channels?: { channel: string; sessions: number; newUsers?: number; returningUsers?: number; conversions?: number; revenue?: number }[];
  };
  rankings?: {
    tracked: number;
    top3?: number;
    top10?: number;
    movers?: { keyword: string; position: number; change: number }[];
  };
};
