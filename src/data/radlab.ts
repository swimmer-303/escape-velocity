// Written with AI assistance (Claude Code). See README "Use of AI tools".
// NASA OSDR RadLab (Radiation Dosimetry Database): real ISS absorbed-dose readings,
// fetched at build time (archived; RadLab's ISS series is not a live feed).

export interface RadlabSnapshot {
  fetchedAt: string;
  queryUrl: string;
  spacecraft: string;
  instrument: string;
  startDate: string;
  endDate: string;
  units: string;
  meanDoseRatePerDay: number;
  dailySeries: { date: string; value: number }[];
  notes: string;
}

const files = import.meta.glob<RadlabSnapshot>('./snapshots/radlab-iss*.json', { eager: true, import: 'default' });
export const RADLAB_ISS: RadlabSnapshot | null = files['./snapshots/radlab-iss.json'] ?? null;
export const RADLAB_ISS_MAY2024: RadlabSnapshot | null = files['./snapshots/radlab-iss-may2024.json'] ?? null;
