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
- Client-side framework interactivity. There is exactly one behavior — the scroll-spy nav — in ~70 lines of vanilla JS.

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
│   └── main.js               # ~70 lines: scroll-spy nav only
├── static/
│   ├── og-image.png          # 1200×630 link-preview card (rasterised, committed)
│   ├── resume.pdf            # you supply this
│   └── projects/*.png        # project thumbnails
├── build.mjs                 # ~60 lines, Node stdlib only
├── dist/                     # generated; gitignored; deployed
│   ├── favicon.svg           #   generated from the palette
│   └── og-image.svg          #   generated; source for the PNG above
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

## Generated assets

Two brand assets are produced by `build.mjs` rather than committed, so they cannot drift from the palette:

- **`favicon.svg`** — a rounded square in the accent colour with the first initial of `meta.name`. At 16px anything more detailed turns to mud. Linked from `<head>` with a content hash.
- **`og-image.svg`** — the 1200×630 link-preview card, drawn from the same tokens: accent rule along the top, name, accent hairline, italic title, wrapped tagline, bare URL in letterspaced caps, and the monogram at the right.

Switch `theme.palette` and both regenerate in the accent of the new palette on the next build.

**The PNG regenerates too**, with one caveat. Social scrapers reject SVG, and Node has no font renderer — so `build.mjs` shells out to headless Chrome (or Edge) to rasterise the card. That is an external binary, not an npm dependency: nothing is installed, and its absence is not fatal.

The result is committed at `static/og-image.png` and keyed to a hash of the SVG in `static/.og-image.hash` (gitignored), so:

- Change your name, tagline, or palette → the hash moves, the card re-renders, and the build prints `og-image rendered`.
- Change nothing → `og-image cached`, and no browser is launched.
- No browser, or the render fails → the build prints a warning, keeps the committed PNG, and **leaves the stamp unset** so the next build with a browser present retries. Prints `og-image stale`.

Set `CHROME_PATH` if your browser lives somewhere unusual. Rendering is deterministic — returning to a previous palette reproduces a byte-identical PNG.

Because the PNG is committed, a CI runner without a browser still deploys the correct card, as long as you committed it after your last content change. The build tells you which of the three states you are in on every run.

If you would rather not rely on a browser at all, any SVG-to-PNG converter pointed at `dist/og-image.svg` at 1200×630 produces the same thing.

---

## Runtime JavaScript

`src/main.js` does exactly one thing: it marks the nav link for whichever section you are reading with `aria-current="true"`. All the active styling hangs off that attribute in CSS, so this file never touches classes or content.

**Why a scroll listener rather than an `IntersectionObserver`.** An observer tells you *that* a boundary was crossed, not *which* section you are in, and it cannot answer the page-bottom case at all: a short final section may never reach the activation band, so the last nav item would never light up. The implementation instead measures on scroll — the last section whose top has passed a line 30% down the viewport wins, with an explicit guard that hands the bottom of the page to the final section.

It runs straight from a passive listener with no `requestAnimationFrame` coalescing. Browsers already fire `scroll` at most once per frame, measuring four elements is cheap, and depending on rAF means the nav goes stale whenever rAF is paused — as it is in any background tab.

Without the script the first link stays marked (`build.mjs` renders it that way), which is a reasonable no-JS default. The page is fully readable and every link works; you lose a highlight.

---

## Visual design

The register is a faculty or research-group page: light ground, serif type, hairline rules, restrained accent. **Palette and typography are configuration, not code** — `theme.palette` and `theme.type` in `content.json` set `data-palette` / `data-type` on `<html>`, and the stylesheet keys every token off those attributes.

**Palettes** — pick one with `theme.palette`. All three are verified against WCAG AA (see [Accessibility](#accessibility)).

| | `ink` (default) | `paper` | `sage` |
|---|---|---|---|
| ground | `#fdfdfc` | `#faf6ec` | `#fbfbf9` |
| hovered row | `#f4f6f8` | `#f2ebda` | `#f1f4f0` |
| hairline | `#e4e8ec` | `#e6dcc6` | `#e0e5df` |
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
  | `paper` | 8.78 | 5.10 | 16.09 | 7.59 |
  | `sage` | 7.59 | 4.76 | 16.45 | 5.90 |

  Re-run the check if you change a token — muted is the role with the least headroom.
- Every external link gets `rel="noopener noreferrer"`; links opening a new tab say so in visually-hidden text.

---

## Performance budget

Measured, not aspirational:

| Asset | Raw | Gzipped |
|---|---|---|
| `index.html` (content inlined) | 8.4 KB | 2.4 KB |
| `style.css` | 12.6 KB | 3.3 KB |
| `main.js` | 2.2 KB | 1.0 KB |
| `favicon.svg` | 0.3 KB | 0.3 KB |
| Web fonts | **0 KB** | — |
| **Total, first view** | 23.5 KB | **6.8 KB** |

`static/og-image.png` is 71 KB but never touches this budget — only link scrapers fetch it, never a visitor.

No render-blocking third parties, no analytics by default, and — because no web font is loaded — no swap flash at all. Carrying three palettes and three type stacks costs about 2 KB raw over a single hardcoded theme, and almost nothing after compression; gzip is what the budget should be judged on. Project thumbnails are lazy-loaded with explicit `width`/`height` to prevent layout shift. The target is 100/100/100/100 on Lighthouse — realistic at this size, and worth treating as a regression check rather than a vanity metric.

---

## Deployment

The workflow lives at `.github/workflows/deploy.yml`. It runs `node build.mjs` on every push to `main`, sanity-checks the output, and publishes `dist/`. No `npm install` — there is nothing to install.

**One-time setup:** repo *Settings → Pages → Source: **GitHub Actions***. Without that the workflow runs green but nothing is published.

**CI never re-renders the link-preview PNG.** Runners lack Georgia and Palatino, so a re-render there would ship a card in a different typeface than the one you reviewed. `build.mjs` detects `CI` and skips it, shipping the committed PNG instead. That is why `static/.og-image.hash` is committed alongside the PNG — it is the cache key, and without it every CI build would see a mismatch. Refresh both locally and commit them together; CI prints a warning if they are out of date.

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
5. **Polish** — done, except two items that are deliberately outstanding:
   - **`static/resume.pdf`** — yours to supply. Drop it in and add `"resume": "static/resume.pdf"` to `meta`; a "View Full Résumé" link then appears under Experience. Referenced-but-missing assets fail the build, so a typo here is caught.
   - **Subset Source Serif** — deferred, not forgotten. The system stack (Georgia/Palatino) already renders the intended design at zero bytes, and a web font would add ~30 KB and a swap flash to fix something that is not broken. Put it at the front of `--font-heading` if you ever want the exact cut.
6. **Ship** — workflow file, first deploy, then decide on the repo rename or custom domain.

Phases 1–2 produce something genuinely presentable; everything after is refinement.

---

## Open decisions

- **Repo rename vs. custom domain vs. subpath.** Affects only asset paths, and relative paths keep all three open. Decide before sharing the URL anywhere, since a rename changes the link.
- **Writing section.** Include it only if there is something to list — an empty section reads worse than a missing one. Omitting it from `sections` removes it cleanly.
- **Analytics.** None by default. If wanted later, prefer a lightweight cookieless option over Google Analytics; it is one script tag and a line in the budget table.
- **Resume PDF.** Not yet supplied. Also whether to link it in the left rail alongside the socials, or as a button under the tagline. Rail is tidier; button gets more clicks.
