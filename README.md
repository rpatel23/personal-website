# personal-website

A single-page resume / portfolio site in the spirit of [brittanychiang.com](https://brittanychiang.com) — sticky left rail, scrolling right column, dark palette, teal accent.

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
- Client-side framework interactivity. There are exactly three behaviors and they are ~60 lines of vanilla JS.

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
│   ├── style.css             # ~350 lines, CSS custom properties
│   └── main.js               # ~60 lines: scroll-spy, spotlight, motion guard
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
- **Run time** owns *behavior*. `main.js` never touches content — it only reacts to scroll and pointer position.

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
    "resume": "static/resume.pdf",
    "themeColor": "#0f172a"
  },

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
4. Read `src/index.html` and substitute the `<!--@nav-->`, `<!--@hero-->`, `<!--@main-->`, and `<!--@head-->` markers.
5. Write `dist/index.html`; copy `src/style.css`, `src/main.js`, and `static/` across.

Comment markers are used instead of `{{mustache}}` placeholders so `src/index.html` stays a valid, openable HTML file — you can load it directly in a browser to check the shell's layout without running the build.

The `<!--@head-->` slot receives a generated `<title>`, `<meta name="description">`, Open Graph and Twitter card tags, and a [JSON-LD `Person`](https://schema.org/Person) block — all derived from `meta`. That is most of the SEO story, free, from data you already wrote.

**Cache busting.** Rather than content-hashed filenames (which would mean rewriting references and complicating the script), append a short hash of each asset's contents as a query string: `style.css?v=a1b2c3`. Four lines using `node:crypto`, same practical effect.

---

## Runtime JavaScript

`src/main.js` does exactly three things:

1. **Scroll-spy nav.** An `IntersectionObserver` over the section elements sets `aria-current="true"` on the matching left-rail link. The active-state styling (brighter text, extended indicator line) is pure CSS keyed off that attribute — no class juggling.
2. **Cursor spotlight.** A `pointermove` listener writes `--mouse-x` / `--mouse-y` custom properties on `<body>`; a fixed radial-gradient overlay reads them. Updates are throttled with `requestAnimationFrame`. Skipped entirely on coarse pointers (`matchMedia('(pointer: fine)')`) — it is meaningless on touch and costs battery.
3. **Motion guard.** If `prefers-reduced-motion: reduce` matches, the spotlight is never attached and scroll-linked transitions are disabled.

No polyfills, no feature detection beyond the two `matchMedia` checks. `IntersectionObserver` and CSS custom properties are universally supported in every browser this site targets. If JS fails to load, the page is fully readable and every link works; you lose a highlight and a glow.

---

## Visual design

**Palette** — dark slate ground, single teal accent, defined once as custom properties on `:root`:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0f172a` | page ground |
| `--surface` | `rgba(30, 41, 59, 0.5)` | hovered card |
| `--text` | `#94a3b8` | body copy |
| `--heading` | `#e2e8f0` | name, section and entry headings |
| `--muted` | `#64748b` | dates, nav idle, footer |
| `--accent` | `#5eead4` | links, active nav, hovered headings |
| `--accent-soft` | `rgba(45, 212, 191, 0.1)` | tag pill background |

Committing to a single dark theme (rather than a light/dark toggle) is deliberate — it halves the CSS surface and matches the reference's character. `color-scheme: dark` is set so form controls and scrollbars follow.

**Typography** — Inter, self-hosted as a woff2 subset in `static/` rather than pulled from Google Fonts (one fewer third party, no FOUT from a cross-origin request), with a `system-ui` fallback stack. Fluid sizing via `clamp()`: name at `clamp(2.5rem, 5vw, 3rem)`, body at `1rem`/`1.6`, dates and tags at `0.75rem` with generous letter-spacing.

**Layout**

- Single CSS Grid on the page wrapper. Below `1024px` it collapses to one column and the left rail becomes a normal, non-sticky header — mobile gets a plain vertical document, which is the right answer.
- At `≥1024px`: two equal columns, left is `position: sticky` with `height: 100vh` and vertically centered content; right scrolls with `padding-block: 6rem`.
- Max content width ~1200px, centered, `padding-inline: clamp(1.5rem, 5vw, 3rem)`.

**Section detail**

- *Nav links* — uppercase, `letter-spacing: 0.1em`, tiny. Each has a `::before` horizontal rule that animates from `2rem` to `4rem` and from `--muted` to `--heading` on hover and on `[aria-current]`. This is the reference's most recognizable touch.
- *Experience entries* — a 12-column subgrid: date range spans 3, content spans 9. On hover the card lifts to `--surface` with a soft inset ring, and sibling entries drop to `opacity: 0.5` via `.entries:hover > *:not(:hover)`. The whole card is clickable through a stretched pseudo-element over the title link, so the hit target is large without nesting invalid markup.
- *Tag pills* — `border-radius: 999px`, `--accent-soft` background, `--accent` text, `0.75rem`, wrapped in a `<ul>` with `list-style: none` so screen readers still announce the count.
- *Projects* — same entry grid; the optional thumbnail takes the left 3 columns in place of the date.
- *Writing* — compact rows, year on the left, title as link.

---

## Accessibility

Treated as part of the design, not a later pass:

- Semantic landmarks: `<header>` for the rail, `<main>`, `<section aria-labelledby>` per section, `<footer>`.
- A visually-hidden "Skip to content" link as the first focusable element.
- Section headings are `<h2>` and always present in the DOM — the reference hides them visually on desktop since the nav provides the label; do the same with an `.sr-only` utility rather than `display: none`.
- Visible focus rings everywhere, using `--accent` at 2px offset. Never `outline: none` without a replacement.
- Contrast: `--text` on `--bg` is roughly 7:1, `--muted` on `--bg` roughly 4.6:1 — both clear AA for their sizes. Verify with a checker before shipping and darken `--bg` slightly if `--muted` comes up short.
- The decorative spotlight overlay is `aria-hidden` and `pointer-events: none`.
- Every external link gets `rel="noopener noreferrer"`; links opening a new tab say so in visually-hidden text.

---

## Performance budget

| Asset | Budget |
|---|---|
| `index.html` (content inlined) | ≤ 25 KB |
| `style.css` | ≤ 12 KB |
| `main.js` | ≤ 3 KB |
| Inter woff2 subset | ≤ 30 KB |
| **Total, first view** | **≤ 70 KB** |

No render-blocking third parties, no analytics by default, no web font swap flash (`font-display: swap` with a metrics-matched fallback). Project thumbnails are lazy-loaded with explicit `width`/`height` to prevent layout shift. The target is 100/100/100/100 on Lighthouse — realistic at this size, and worth treating as a regression check rather than a vanity metric.

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
4. **Behavior** — `main.js`: scroll-spy, spotlight, motion guard.
5. **Polish** — `<head>` generation and JSON-LD, OG image, favicon, font subsetting, focus states, contrast audit, Lighthouse pass.
6. **Ship** — workflow file, first deploy, then decide on the repo rename or custom domain.

Phases 1–2 produce something genuinely presentable; everything after is refinement.

---

## Open decisions

- **Repo rename vs. custom domain vs. subpath.** Affects only asset paths, and relative paths keep all three open. Decide before sharing the URL anywhere, since a rename changes the link.
- **Writing section.** Include it only if there is something to list — an empty section reads worse than a missing one. Omitting it from `sections` removes it cleanly.
- **Analytics.** None by default. If wanted later, prefer a lightweight cookieless option over Google Analytics; it is one script tag and a line in the budget table.
- **Resume PDF.** Whether to link it in the left rail alongside the socials, or as a button under the tagline. Rail is tidier; button gets more clicks.
