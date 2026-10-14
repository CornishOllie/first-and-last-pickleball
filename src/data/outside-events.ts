// Tournaments run by other people that club members go to or might fancy.
// Edit this list to add or remove events. Past events drop off automatically
// the next time the site is built.
export interface OutsideEvent {
  name: string;
  /** First day, YYYY-MM-DD. Used for sorting and for hiding past events. */
  start: string;
  /** Last day, YYYY-MM-DD. Leave out for a one-day event. */
  end?: string;
  /** Shown as written, e.g. "17 and 18 October". */
  when: string;
  venue: string;
  organiser: string;
  details: string;
  /** Booking or info link. Leave out if the organiser only takes entries by message. */
  url?: string;
  /** Entry email, shown as a mailto link. */
  email?: string;
  /** Set when club members are going. */
  clubGoing?: boolean;
  /** Anything worth a heads-up, e.g. a clash with a club date. */
  note?: string;
}

export const outsideEvents: OutsideEvent[] = [
  {
    name: 'Torquay Autumn Picklefest',
    start: '2026-10-17',
    end: '2026-10-18',
    when: 'Saturday 17 and Sunday 18 October',
    venue: 'Torquay Tennis Club, Belgrave Road, Torquay, TQ2 5HP',
    organiser: 'Torquay Pickleball Club',
    details:
      'Nine indoor courts, self-rated so you play at your own level, with open play and a free mixed doubles knockout. Day tickets £25, weekend £40, juniors £15.',
    url: 'https://www.tickettailor.com/events/torquaypickleballclub/2166864',
  },
  {
    name: 'Penzance Doubles Tournament',
    start: '2026-11-15',
    when: 'Sunday 15 November, 9am to 2pm',
    venue: 'Mounts Bay Academy, Penzance',
    organiser: 'Penzance Pickleball Club',
    details:
      "Up to 24 pairs (48 players) on 12 courts, with at least 5 games each and a knockout stage for the podium. No partner? Enter as an individual and they'll match you up. Entry is £25, paid before the event. Medals or trophies for the top three, plus prizes such as club T-shirts, free open sessions and vouchers. To enter, email the club, or join their Spond group with the code MKBJX and you'll be invited to the competition automatically.",
    email: 'penzancepickleballclub@gmail.com',
    clubGoing: true,
  },
  {
    name: 'Bristol Winter Tournament',
    start: '2026-11-21',
    when: 'Saturday 21 November',
    venue: 'Clifton College Indoor Tennis Centre, Abbots Leigh Road, Bristol, BS8 3QD',
    organiser: 'Pickleball UK Tour',
    details:
      "Men's, women's and mixed doubles, Open and 50+, at 3.0, 3.5 and 4.0 levels. Round robin then knockout, with at least four matches each. £28 per person per event. Entries close 15 November, or sooner if it fills.",
    url: 'https://pickleballuktour.co.uk/event/bristol-pickleball-uk-tour-winter-2026-tournament/',
  },
  {
    name: 'Swindon Winter Tournament',
    start: '2026-11-28',
    end: '2026-11-29',
    when: 'Saturday 28 and Sunday 29 November',
    venue: 'Delta Tennis Centre, Welton Road, Swindon, SN5 7XF',
    organiser: 'Pickleball UK Tour',
    details:
      "Singles, doubles and mixed doubles across Open, 45+ and 60+, at 3.0, 3.5 and 4.0+ levels. Round robin then knockout, with at least four matches each, on 16 courts. £28 per person per event.",
    url: 'https://pickleballuktour.co.uk/event/swindon-pickleball-uk-tour-winter-tournament-2026/',
    clubGoing: true,
  },
];

export const calendarLinks = [
  {
    label: 'Pickleball England tournament calendar',
    url: 'https://www.pickleballengland.org/tournaments/',
  },
  { label: 'Pickleball UK Tour', url: 'https://pickleballuktour.co.uk/' },
];
