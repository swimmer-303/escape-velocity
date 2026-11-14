// Written with AI assistance (Claude Code). See README "Use of AI tools".
// NASA Open Science Data Repository (OSDR): real study IDs for the "Real Science" cards.
// Curated at build time from https://osdr.nasa.gov/osdr/data/search (only studies the API returned).

export interface OsdrCard {
  osdId: string;
  title: string;
  takeaway: string;
  url: string;
  searchTerm: string;
  tieIn: 'greenhouse' | 'shelter' | 'crew' | 'o2';
}

const files = import.meta.glob<OsdrCard[]>('./snapshots/osdr-cards.json', { eager: true, import: 'default' });
export const OSDR_CARDS: OsdrCard[] = files['./snapshots/osdr-cards.json'] ?? [];
