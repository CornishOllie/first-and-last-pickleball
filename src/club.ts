// Which club this website is for. Chosen at build time by PUBLIC_CLUB_SLUG (default First & Last).
// To add a club: a new file in src/clubs/, a line below, and a row in the clubs table.
import type { ClubConfig } from './clubs/types.ts';
import firstAndLast from './clubs/first-and-last.ts';

const CLUBS: Record<string, ClubConfig> = {
  [firstAndLast.slug]: firstAndLast,
};

const slug = (import.meta.env?.PUBLIC_CLUB_SLUG as string | undefined) || 'first-and-last';
const found = CLUBS[slug];
if (!found) throw new Error(`Unknown club "${slug}". Add src/clubs/${slug}.ts and list it in src/club.ts.`);

export const CLUB: ClubConfig = found;
