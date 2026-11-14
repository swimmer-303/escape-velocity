// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The astronauts of each crew. Everyone here is made up: fictional first names, no real people.
// Portraits live in one sprite sheet per crew (public/art/crew-<n>.png, made by
// scripts/process-portraits.py): one square cell per astronaut, left to right, in roster order,
// with an "AI" tag on every cell and a full "AI-generated" strip along the bottom of the sheet.

export interface CrewMember {
  name: string;
  role: string;
  /** One short, kid-friendly line about their personality. */
  fact: string;
}

export interface CrewRoster {
  /** Which expedition of the campaign (1-based). */
  expedition: number;
  /** Sprite sheet with one portrait per member, in the same order as `members`. */
  sheet: string;
  members: CrewMember[];
}

export const CREWS: CrewRoster[] = [
  {
    expedition: 1,
    sheet: '/art/crew-1.png',
    members: [
      { name: 'Amara', role: 'Commander', fact: 'Hums a happy song every morning.' },
      { name: 'Kenji', role: 'Engineer', fact: 'Can fix almost anything with tape.' },
      { name: 'Lucía', role: 'Botanist', fact: 'Grows the best lettuce on Mars.' },
      { name: 'Omar', role: 'Doctor', fact: 'Tells the silliest jokes on the crew.' },
    ],
  },
  {
    expedition: 2,
    sheet: '/art/crew-2.png',
    members: [
      { name: 'Priya', role: 'Commander', fact: 'Loves a tidy checklist.' },
      { name: 'Tomás', role: 'Pilot', fact: 'Practices landings in his dreams.' },
      { name: 'Freya', role: 'Geologist', fact: 'Gives every rock she finds a name.' },
      { name: 'Kwame', role: 'Engineer', fact: 'Builds tiny models of the base for fun.' },
      { name: 'Noor', role: 'Radiation specialist', fact: 'Checks the space weather before breakfast.' },
    ],
  },
  {
    expedition: 3,
    sheet: '/art/crew-3.png',
    members: [
      { name: 'Mei', role: 'Commander', fact: 'Says "teamwork!" ten times a day.' },
      { name: 'Diego', role: 'Roboticist', fact: 'Gave every robot at the base a nickname.' },
      { name: 'Aisha', role: 'Doctor', fact: 'Makes sure everyone drinks their water.' },
      { name: 'Lars', role: 'Engineer', fact: 'Plays the harmonica after dinner.' },
      { name: 'Zuri', role: 'Botanist', fact: 'Sings to the tomatoes every day.' },
      { name: 'Ravi', role: 'Pilot', fact: 'Can spot a dust devil from far away.' },
    ],
  },
];

/** The roster for an expedition (clamped to the crews we have, like expeditionSpec). */
export function crewFor(expedition: number): CrewRoster {
  return CREWS[Math.max(0, Math.min(CREWS.length - 1, expedition - 1))];
}

/** One crew member's short line for the end screen. The commander cheers a launch; the doctor (if any) reassures after an early trip home. */
export function crewQuote(expedition: number, won: boolean): { member: CrewMember; index: number; line: string } {
  const roster = crewFor(expedition);
  const find = (role: string) => roster.members.findIndex((m) => m.role === role);
  const doctor = find('Doctor');
  const index = won ? Math.max(0, find('Commander')) : doctor >= 0 ? doctor : Math.max(0, find('Commander'));
  const line = won
    ? 'Great work, team. Next stop: home!'
    : 'Everyone is safe and going home. We will try a new plan next time.';
  return { member: roster.members[index], index, line };
}
