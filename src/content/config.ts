import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const news = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    author: z.string().optional(),
  }),
});

const competitions = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/competitions' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    format: z.string(),
    // upcoming  → not played yet (shows entry info)
    // live      → in progress (e.g. a box league running over weeks)
    // complete  → finished (shows podium + final standings)
    status: z.enum(['upcoming', 'live', 'complete']),
    // Marks demo/placeholder content so it's clearly flagged on the site.
    sample: z.boolean().optional(),
    summary: z.string(),
    // For 'upcoming' comps: a line on how to enter.
    entryInfo: z.string().optional(),
    // Who won. place 1/2/3 (or more). The heart of a results page.
    podium: z
      .array(
        z.object({
          place: z.number(),
          names: z.string(),
          note: z.string().optional(),
        })
      )
      .optional(),
    // Optional full table — round-robins, box leagues, etc.
    // Any subset of columns can be present; the renderer shows what's there.
    standings: z
      .array(
        z.object({
          rank: z.number().optional(),
          team: z.string(),
          played: z.number().optional(),
          won: z.number().optional(),
          lost: z.number().optional(),
          pointsFor: z.number().optional(),
          pointsAgainst: z.number().optional(),
          points: z.number().optional(),
        })
      )
      .optional(),
    photos: z.array(z.string()).optional(),
  }),
});

export const collections = { news, competitions };
