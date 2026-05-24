# First & Last Pickleball Club — website

Static site for the club, built with [Astro](https://astro.build).

## Run locally

```sh
npm install
npm run dev
```

Opens at http://localhost:4321.

## Build for production

```sh
npm run build
```

Outputs to `dist/`. Preview with `npm run preview`.

## Editing content

- **Pages** live in `src/pages/` — `.astro` files mix HTML, CSS and a bit of frontmatter logic.
- **News posts** live in `src/content/news/` as markdown files. Add a new `.md` file with frontmatter and it'll appear on the news page and homepage automatically.
- **Styles** are in `src/styles/global.css` and a `<style>` block per page/component.

### Adding a news post

Create `src/content/news/YYYY-MM-slug.md`:

```md
---
title: Match report — Hayle away
date: 2026-06-12
summary: Three rubbers, two cakes, one bruised ego.
author: Ollie
---

Body content in markdown here...
```

## Things to fill in before launch

- [ ] Real Spond join URL in `src/pages/join.astro` (search for `REPLACE_ME`)
- [ ] Real club email — currently `hello@firstandlastpickleball.co.uk`
- [ ] Committee names and history on `src/pages/about.astro`
- [ ] Real photos from sessions (currently using free Unsplash stock — see below)
- [ ] **Wednesday Intermediate Plus session time** (currently "Time TBC" on `src/pages/sessions.astro`)

## Photos

Real club photos live in `public/img/`:

- `action.jpg` — home hero
- `group.jpg` — home community band
- `hall-wide.jpg` — sessions page header
- `court-action.jpg` — about page feature
- `medals.jpg` — about page tournaments section

To swap a photo, drop a new file into `public/img/` and update the `src` in the relevant page (or just overwrite the existing filename).

## Deploying

Push the repo to GitHub, then connect it to **Netlify** or **Vercel** — both will:
- detect Astro automatically
- build on every push
- serve at a free `.netlify.app` / `.vercel.app` URL until you point a custom domain

When the `.co.uk` domain is registered, add it in the Netlify/Vercel dashboard under Domains, and update the registrar's nameservers (or add an `ALIAS`/`CNAME` record) per their instructions.
