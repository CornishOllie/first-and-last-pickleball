// What every club's config file holds. Club details that change often (members, sessions) live in the database.
export interface TimetableSlot {
  day: string;
  time: string;
  name: string;
  who: string;
  ball: string;
  price: string;
  description: string;
  flag?: boolean;
}

export interface ClubConfig {
  /** The club's id in the clubs table. */
  id: string;
  slug: string;
  name: string;
  shortName: string;
  contactEmail: string;
  /** Only Spond groups whose name contains this are shown to hosts. */
  spondGroupMatch: string;
  /** The weekly timetable shown on the Sessions page. */
  timetable: TimetableSlot[];
}
