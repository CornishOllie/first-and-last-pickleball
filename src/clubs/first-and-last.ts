// First & Last Pickleball Club. One file like this per club; the site picks it by PUBLIC_CLUB_SLUG at build time.
import type { ClubConfig } from './types.ts';

const club: ClubConfig = {
  // Must match the row in the clubs table (supabase/play-schema-v3.sql).
  id: '8c272569-0e18-46a7-be5b-e9dbaef31b1a',
  slug: 'first-and-last',
  name: 'First & Last Pickleball Club',
  shortName: 'F&L',
  contactEmail: 'hello@firstandlastpickleball.co.uk',
  spondGroupMatch: 'First & Last',
  timetable: [
  {
    day: 'Sunday',
    time: '8:00 – 9:00',
    name: 'Competition Prep',
    who: 'Ages 10+ · fixed partners',
    ball: 'Franklin X-40',
    price: '£4',
    description:
      "Faster, focused play with the Franklin X-40 outdoor ball — sharper bounce, more pace. Partners are fixed for the session.",
  },
  {
    day: 'Sunday',
    time: '9:00 – 10:30',
    name: '1st Sunday Session',
    who: 'Ages 10+ · beginners welcome',
    ball: 'Gamma Photon',
    price: '£5',
    description:
      "Easy hitting, beginners encouraged. The friendliest session in the week — bring trainers and a drink, we've got paddles to borrow.",
  },
  {
    day: 'Sunday',
    time: '10:30 – 12:00',
    name: '2nd Sunday Session',
    who: 'Ages 10+ · beginners welcome',
    ball: 'Gamma Photon',
    price: '£5',
    description:
      'Same format as the 9:00 session — drop into whichever slot suits.',
  },
  {
    day: 'Tuesday',
    time: '4:30 – 6:30',
    name: 'Improvers',
    who: '16+ · know the rules, score, hold a rally',
    ball: 'Gamma Photon',
    price: '£6',
    description:
      'For players who have the basics down. Also the slot for Intermediate Plus assessments — see Wednesdays below.',
  },
  {
    day: 'Wednesday',
    time: '7:00 – 9:00 pm',
    name: 'Intermediate Plus',
    who: '18+ · invite only · assessments on Tuesdays 4:30 – 5:00',
    ball: 'Franklin X-40',
    price: 'See Spond',
    description:
      'For players able to play all aspects of the game — dinking, short play and power. Want to be considered? Drop in to the start of Tuesday for an assessment.',
    flag: true,
  },
  {
    day: 'Thursday',
    time: '5:30 – 7:00',
    name: 'Improvers',
    who: '16+ · know the rules, score, hold a rally',
    ball: 'Gamma Photon',
    price: '£5',
    description: 'Same improvers format as Tuesday and Friday.',
  },
  {
    day: 'Friday',
    time: '4:30 – 6:30',
    name: 'Improvers',
    who: '14+ · know the rules, score, hold a rally',
    ball: 'Gamma Photon',
    price: '£6',
    description: 'Round off the week — same improvers format.',
  },
  ],
};

export default club;
