# personal-website

A single-page academic-leaning resume site: sticky left rail, scrolling right column, light ground, serif throughout. The two-column sticky layout is a common pattern; the visual treatment is its own.

The guiding constraint: **the frontend is hand-written HTML/CSS/JS, and the "backend" is a single JSON file.** Editing the site means editing `content/content.json`. No framework, no bundler, no `node_modules`.

---

## Table of contents

- [Goals and non-goals](#goals-and-non-goals)
- [Why this stack](#why-this-stack)
- [Architecture](#architecture)
- [Content model](#content-model)
- [The build script](#the-build-script)
- [Runtime JavaScript](#runtime-javascript)
- [Visual design](#visual-design)
- [Accessibility](#accessibility)
- [Performance budget](#performance-budget)
- [Deployment](#deployment)
- [Local development](#local-development)
- [Implementation phases](#implementation-phases)
- [Open decisions](#open-decisions)

---

## Goals and non-goals

**Goals**

- Updating content never requires touching markup. Add a job, add a project, reorder things — all in JSON.
- Content ships *inside* `index.html`. Link-preview bots (LinkedIn, Slack, iMessage) and ATS scrapers generally do not execute JavaScript; an empty shell gives them nothing.
- Zero runtime dependencies and zero build dependencies. `git clone` in two years and it still builds with whatever Node is installed.
- Total payload under 100 KB uncompressed, excluding the resume PDF.

**Non-goals**

- A CMS, an admin UI, or a database. The "configuration of content" is a text file in git.
- Multiple pages, routing, or a blog. If a blog gets added later, that is the moment to reconsider Astro.
- Client-side framework interactivity. There is exactly one behavior — the scroll-spy nav — in ~25 lines of vanilla JS.

---

## Why this stack

The one decision that actually matters for a resume site is *whether your content is in the HTML or gets painted there by JavaScript*. Everything else — HMR, minification, hashed filenames — is negligible at this size.

| Approach | Content in HTML? | Deps | Verdict |
|---|---|---|---|
| Zero-build vanilla | No — fetched at runtime | none | Flash of empty layout; bad link previews |
| **Tiny build script** | **Yes** | **none** | **Chosen** |
| Vite | No — bundled, still JS-painted | ~150 MB | Dev-server niceties without solving prerendering |
| Astro | Yes | ~200 MB | Correct but heavier; revisit if a blog appears |

Vite deserves a specific note because it is the obvious suggestion: Vite is a dev server and bundler, **not** a static site generator. With vanilla JS it bundles `content.json` into your JS, so you skip a network round-trip, but `index.html` still ships empty. It does not solve the problem that justifies having a build step here.

A ~60-line Node script using only the standard library gets content into the HTML, has nothing to audit or upgrade, and is short enough to read in one sitting.

---

## Architecture

```
personal-website/
├── content/
│   └── content.json          # ← the only file you edit to update the site
├── src/
│   ├── index.html            # shell with <!--@slot--> markers
│   ├── style.css             # ~500 lines; palettes + type as custom properties
│   └── main.js               # ~25 lines: scroll-spy only
├── static/
│   ├── resume.pdf
│   ├── og-image.png          # 1200×630 link-preview card
│   ├── favicon.svg
│   └── projects/*.png        # project thumbnails
├── build.mjs                 # ~60 lines, Node stdlib only
├── dist/                     # generated; gitignored; deployed
└── .github/workflows/deploy.yml
```

The split that keeps this simple:

- **Build time** owns *content*. Every string a visitor reads is baked into `dist/index.html` by `build.mjs`.
- **Run time** owns *behavior*. `main.js` never touches content — it only reacts to scroll position.

That separation is why the runtime JS stays tiny, and why disabling JavaScript entirely still leaves a fully readable résumé.

---

## Content model

`content/content.json` is the whole configuration surface. Proposed schema:

```jsonc
{
  "meta": {
    "name": "Raj Patel",
    "title": "Software Engineer",
    "tagline": "I build reliable backends and the tools that keep them honest.",
    "url": "https://rpatel23.github.io/personal-website/",
    "description": "Software engineer specializing in ...",   // <meta description> + OG
    "ogImage": "static/og-image.png",
    "resume": "static/resume.pdf"
  },

  // Visual identity. palette: ink | paper | sage — type: serif | hybrid | sans.
  // Validated at build time; an unknown name fails with the list of valid ones.
  "theme": { "palette": "ink", "type": "serif" },

  // Optional. Rename any section in both the nav and its heading.
  // e.g. an academic page might want Publications and Appointments.
  "labels": { "writing": "Publications" },

  "socials": [
    { "label": "GitHub",   "url": "https://github.com/rpatel23", "icon": "github" },
    { "label": "LinkedIn", "url": "...",                         "icon": "linkedin" },
    { "label": "Email",    "url": "mailto:...",                  "icon": "mail" }
  ],

  // Drives BOTH the left-rail nav and the order of sections in the right column.
  // Remove an entry and the section disappears from the build entirely.
  "sections": ["about", "experience", "projects", "writing"],

  "about": {
    // Array of paragraphs. Inline <a> and <strong> permitted; see Security note.
    "body": [
      "I'm an engineer focused on ...",
      "Outside of work I ..."
    ]
  },

  "experience": [
    {
      "start": "2023",
      "end": "Present",              // string, not a date — "Present" must be expressible
      "role": "Senior Software Engineer",
      "company": "Acme Corp",
      "companyUrl": "https://acme.example",
      "priorRoles": ["Software Engineer"],   // optional, rendered beneath the current role
      "summary": "Led the migration of ...",
      "tags": ["Go", "Postgres", "Kubernetes"]
    }
  ],

  "projects": [
    {
      "name": "Project name",
      "url": "https://github.com/...",
      "summary": "One or two sentences.",
      "thumbnail": "static/projects/thing.png",   // optional
      "tags": ["TypeScript", "SQLite"],
      "metric": "1.2k stars"                      // optional badge
    }
  ],

  "writing": [
    { "year": "2025", "title": "Post title", "url": "https://...", "publisher": "Blog" }
  ],

  "footer": {
    "body": "Built with vanilla HTML, CSS, and JavaScript. Deployed on GitHub Pages."
  }
}
```

**Design notes on the schema**

- `sections` is the single source of truth for ordering and presence. The nav and the content column are generated from the same array, so they cannot drift out of sync.
- Dates are strings, deliberately. `"Present"`, `"2019 — 2021"`, and `"Summer 2018"` all need to be expressible; a date type would fight that for no benefit.
- Arrays render in file order. There is no `sort` field — if you want an entry higher, move it up.
- Optional fields (`thumbnail`, `metric`, `priorRoles`) are omitted rather than set to `null`, and the renderer treats absent and empty identically.

**Security note.** `about.body` and `footer.body` permit a small inline HTML subset (`<a>`, `<strong>`, `<em>`, `<code>`). Every *other* string is HTML-escaped by the renderer. Since you are the only author and the content is committed to git, this is a formatting convenience rather than an injection surface — but the escaping default stays on so a future copy-pasted ampersand or angle bracket can't silently break the page.

---

## The build script

`build.mjs`, Node stdlib only, no `package.json` required:

1. `JSON.parse` `content/content.json`.
2. Validate: required keys present, every entry in `sections` has matching data, every referenced local asset exists on disk. **Fail loudly** — a typo should break the build, not silently drop your best project.
3. Render each section to an HTML string with template literals. One small function per section (`renderAbout`, `renderExperience`, …), plus a shared `esc()` helper.
4. Read `src/index.html` and substitute the `<!--@head-->`, `<!--@hero-->`, `<!--@nav-->`, `<!--@socials-->`, and `<!--@main-->` markers.
5. Write `dist/index.html`; copy `src/style.css`, `src/main.js`, and `static/` across.

Comment markers are used instead of `{{mustache}}` placeholders so `src/index.html` stays a valid, openable HTML file — you can load it directly in a browser to check the shell's layout without running the build.

The `<!--@head-->` slot receives a generated `<title>`, `<meta name="description">`, Open Graph and Twitter card tags, and a [JSON-LD `Person`](https://schema.org/Person) block — all derived from `meta`. That is most of the SEO story, free, from data you already wrote.

**Cache busting.** Rather than content-hashed filenames (which would mean rewriting references and complicating the script), append a short hash of each asset's contents as a query string: `style.css?v=a1b2c3`. Four lines using `node:crypto`, same practical effect.

---

## Runtime JavaScript

`src/main.js` does exactly one thing: an `IntersectionObserver` over the section elements sets `aria-current="true"` on the matching left-rail link. The active-state styling is pure CSS keyed off that attribute — no class juggling.

Dropping the cursor spotlight removed the only motion worth guarding, so there is no `prefers-reduced-motion` branch in JS; the reduced-motion media query in the stylesheet handles the rest.

No polyfills, no feature detection. If JS fails to load, the page is fully readable and every link works; you lose a nav highlight.

---

## Visual design

The register is a faculty or research-group page: light ground, serif type, hairline rules, restrained accent. **Palette and typography are configuration, not code** — `theme.palette` and `theme.type` in `content.json` set `data-palette` / `data-type` on `<html>`, and the stylesheet keys every token off those attributes.

**Palettes** — pick one with `theme.palette`. All three are verified against WCAG AA (see [Accessibility](#accessibility)).

| | `ink` (default) | `paper` | `sage` |
|---|---|---|---|
| ground | `#fdfdfc` | `#fdfcf8` | `#fbfbf9` |
| hovered row | `#f4f6f8` | `#f5f2ea` | `#f1f4f0` |
| hairline | `#e4e8ec` | `#e6e0d3` | `#e0e5df` |
| body text | `#4a5568` | `#4a4540` | `#4b544c` |
| muted | `#66707f` | `#706859` | `#69736a` |
| heading | `#10141a` | `#1c1a17` | `#191d1a` |
| accent | `#1f4e79` ink blue | `#8c2f2f` oxblood | `#3f6b52` forest |
| reads as | modern lab site | printed monograph | quiet, understated |

**Type** — pick one with `theme.type`:

- `serif` (default) — Source Serif with a Georgia/Palatino fallback for everything, including metadata. Most traditionally academic.
- `hybrid` — serif headings, sans body. Academic character, faster to scan.
- `sans` — one sans family throughout, looser leading.

No web font is loaded. Georgia and Palatino ship on effectively every OS, so the serif stack renders as intended at zero bytes; a subset Source Serif can go in front of the stack later without touching anything else.

**Adding a palette or type variant** is one block of custom properties in `style.css` plus one entry in the `PALETTES` / `TYPES` array in `build.mjs`. Those arrays are validated, so a typo in `content.json` fails the build with the list of valid names rather than silently falling back.

**Layout**

- Single CSS Grid on the page wrapper. Below `1024px` it collapses to one column and the left rail becomes a normal, non-sticky header.
- At `≥1024px`: a fixed `19rem` rail and a fluid content column, `4.5rem` apart. The rail is `position: sticky`, full height, with the socials pinned to the bottom by `space-between`.
- Max content width `1140px`, `padding-inline: clamp(1.5rem, 5vw, 3rem)`.

**Section detail**

- *Section labels* — small, letterspaced, uppercase, with a hairline rule running to the right edge. Visible at **every** width: an academic page names its parts, and the nav is only a desktop affordance.
- *Nav links* — uppercase and letterspaced, each preceded by a rule that extends from `1.5rem` to `2.75rem` and takes the accent colour on hover and on `[aria-current]`.
- *Entries* — separated by inset hairlines rather than floated as cards. Hovering washes the row to `--surface` and reveals a 2px accent marker in the left margin. Sibling entries are **not** dimmed; that effect is the reference's signature and reads as showy here.
- *Tag pills* — 2px radius, hairline border, faint accent tint. Squarer and quieter than a rounded pill.
- *Projects* — optional thumbnail in the left 3 columns where the date sits elsewhere; entries without one span all 12.
- *Writing* — the same entry markup, year in the date column, publisher in italic beneath the title.

**Single light theme, deliberately.** There is no dark mode and no toggle. `color-scheme: light` is set so form controls and scrollbars follow. Adding a dark palette later is one more `[data-palette]` block.

---

## Accessibility

Treated as part of the design, not a later pass:

- Semantic landmarks: `<header>` for the rail, `<main>`, `<section aria-labelledby>` per section, `<footer>`.
- A visually-hidden "Skip to content" link as the first focusable element.
- Section headings are `<h2>` and always present in the DOM — the reference hides them visually on desktop since the nav provides the label; do the same with an `.sr-only` utility rather than `display: none`.
- Visible focus rings everywhere, using `--accent` at 2px offset. Never `outline: none` without a replacement.
- Contrast is **measured, not estimated**. Every text role in all three palettes clears WCAG AA against its ground; most clear AAA. The tightest is sage's muted text at 4.76:1.

  | | body text | muted | heading | accent |
  |---|---|---|---|---|
  | `ink` | 7.39 | 4.93 | 18.15 | 8.51 |
  | `paper` | 9.23 | 5.36 | 16.91 | 7.98 |
  | `sage` | 7.59 | 4.76 | 16.45 | 5.90 |

  Re-run the check if you change a token — muted is the role with the least headroom.
- Every external link gets `rel="noopener noreferrer"`; links opening a new tab say so in visually-hidden text.

---

## Performance budget

| Asset | Budget |
|---|---|
| `index.html` (content inlined) | ≤ 25 KB |
| `style.css` | ≤ 14 KB raw (**3.3 KB gzipped** today) |
| `main.js` | ≤ 3 KB |
| Web fonts | **0 KB** — system serif stack |
| **Total, first view** | **≤ 25 KB raw** |

No render-blocking third parties, no analytics by default, and — because no web font is loaded — no swap flash at all. Carrying three palettes and three type stacks costs about 2 KB raw over a single hardcoded theme, and almost nothing after compression; gzip is what the budget should be judged on. Project thumbnails are lazy-loaded with explicit `width`/`height` to prevent layout shift. The target is 100/100/100/100 on Lighthouse — realistic at this size, and worth treating as a regression check rather than a vanity metric.

---

## Deployment

GitHub Pages via Actions. `.github/workflows/deploy.yml` runs `node build.mjs` on push to `main` and publishes `dist/`.

```yaml
name: Deploy
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: node build.mjs
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: PAGE_URL_OUTPUT
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

> Replace `PAGE_URL_OUTPUT` with the Actions expression `${{ steps.deployment.outputs.page_url }}` when creating the real workflow file — it is written as a placeholder here only so this README renders cleanly.

**Base path — read this before the first deploy.** This repo is `rpatel23/personal-website`, so Pages serves it from `https://rpatel23.github.io/personal-website/`, a subpath. Every asset reference must therefore be **relative** (`assets/style.css`, not `/assets/style.css`). Root-absolute paths are the single most common cause of "works locally, blank page on Pages."

Two ways to avoid the subpath entirely, both worth considering:

1. Rename the repo to `rpatel23.github.io` — it then serves from the domain root.
2. Point a custom domain at it (`CNAME` file in `static/`, plus DNS) — also root, and a nicer thing to put on a résumé.

If either is done, absolute paths become safe. Until then, keep everything relative and the site works in both cases.

---

## Local development

```bash
node build.mjs          # writes dist/
npx serve dist          # or: python -m http.server -d dist 8000
```

Optionally add a watch mode later using `node:fs.watch` on `content/` and `src/` — another dozen lines, no dependency. Not needed on day one; a rebuild takes milliseconds.

---

## Implementation phases

1. **Shell** — `src/index.html` with the two-column grid, `style.css` with tokens and layout, hardcoded placeholder text. Confirm the sticky rail and responsive collapse behave before any content plumbing exists.
2. **Content pipeline** — write `content.json` with real data, write `build.mjs`, replace the hardcoded text with generated markup. Sections in place: about, experience.
3. **Remaining sections** — projects, writing, footer. Tag pills, thumbnails.
4. **Behavior** — `main.js`: the scroll-spy nav.
5. **Polish** — OG image, favicon, résumé PDF, optional subset Source Serif in front of the system stack, Lighthouse pass. (`<head>` generation, JSON-LD and the contrast audit landed early.)
6. **Ship** — workflow file, first deploy, then decide on the repo rename or custom domain.

Phases 1–2 produce something genuinely presentable; everything after is refinement.

---

## Open decisions

- **Repo rename vs. custom domain vs. subpath.** Affects only asset paths, and relative paths keep all three open. Decide before sharing the URL anywhere, since a rename changes the link.
- **Writing section.** Include it only if there is something to list — an empty section reads worse than a missing one. Omitting it from `sections` removes it cleanly.
- **Analytics.** None by default. If wanted later, prefer a lightweight cookieless option over Google Analytics; it is one script tag and a line in the budget table.
- **Resume PDF.** Whether to link it in the left rail alongside the socials, or as a button under the tagline. Rail is tidier; button gets more clicks.
