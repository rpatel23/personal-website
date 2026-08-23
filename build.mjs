#!/usr/bin/env node
/**
 * Bakes content/content.json into dist/index.html.
 *
 * Node standard library only — no dependencies, no package.json required.
 * Run with: node build.mjs
 */

import { readFile, writeFile, mkdir, readdir, rm, cp, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'dist');
const STATIC = join(ROOT, 'static');
const CONTENT = join(ROOT, 'content', 'content.json');

/* ------------------------------------------------------------------ *
 * Escaping
 * ------------------------------------------------------------------ */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a string for interpolation into HTML text or an attribute. */
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** Allow only schemes that can't execute script. Anything else becomes "#". */
const href = (value) => {
  const raw = String(value ?? '').trim();
  return /^(https?:\/\/|mailto:|tel:|[./#])/i.test(raw) ? esc(raw) : '#';
};

/**
 * Escape everything, then re-admit a small inline subset: <a href>, <strong>,
 * <em>, <code>. Used only for `about.body` and `footer.body`, where hand-written
 * emphasis and links are a formatting convenience.
 */
const rich = (value) => {
  let open = 0;
  return esc(value)
    .replace(/&lt;(\/?)(strong|em|code)&gt;/g, '<$1$2>')
    .replace(/&lt;a href=&quot;([^&]*?)&quot;&gt;/g, (_, url) => {
      const safe = href(url.replace(/&amp;/g, '&'));
      const external = /^https?:\/\//i.test(safe);
      open++;
      return external
        ? `<a href="${safe}" rel="noopener noreferrer" target="_blank">`
        : `<a href="${safe}">`;
    })
    // Only close anchors we actually opened, so a malformed link in the source
    // leaves escaped text rather than an orphan </a>.
    .replace(/&lt;\/a&gt;/g, () => (open > 0 ? (open--, '</a>') : '&lt;/a&gt;'));
};

/* ------------------------------------------------------------------ *
 * Validation — fail loudly rather than silently dropping content
 * ------------------------------------------------------------------ */

const RENDERERS = {};   // populated below; also doubles as the set of known sections

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function validate(data) {
  const errors = [];
  const req = (cond, message) => { if (!cond) errors.push(message); };

  req(data.meta?.name, 'meta.name is required');
  req(data.meta?.title, 'meta.title is required');
  req(data.meta?.description, 'meta.description is required');
  req(Array.isArray(data.sections) && data.sections.length, 'sections must be a non-empty array');

  for (const key of data.sections ?? []) {
    req(RENDERERS[key], `sections lists "${key}", which has no renderer (known: ${Object.keys(RENDERERS).join(', ')})`);
    const value = data[key];
    const populated = Array.isArray(value) ? value.length > 0 : Boolean(value);
    req(populated, `sections lists "${key}" but content.${key} is missing or empty`);
  }

  for (const entry of data.experience ?? []) {
    req(entry.role, `experience entry missing "role": ${JSON.stringify(entry).slice(0, 60)}`);
    req(entry.company, `experience entry "${entry.role}" is missing "company"`);
    req(entry.start, `experience entry "${entry.role}" is missing "start"`);
  }

  // Any local asset that is referenced must actually be on disk.
  const assets = [data.meta?.ogImage, data.meta?.resume]
    .concat((data.projects ?? []).map((p) => p.thumbnail))
    .filter((p) => p && !/^https?:\/\//i.test(p));

  for (const asset of assets) {
    if (!(await exists(join(ROOT, asset)))) errors.push(`referenced asset not found on disk: ${asset}`);
  }

  if (errors.length) {
    console.error('\nBuild failed — content/content.json:\n');
    for (const e of errors) console.error(`  • ${e}`);
    console.error('');
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ *
 * Section renderers
 * ------------------------------------------------------------------ */

const LABELS = { about: 'About', experience: 'Experience', projects: 'Projects', writing: 'Writing' };

const section = (id, body) => `
      <section class="section" id="${id}" aria-labelledby="${id}-heading">
        <h2 class="section__heading" id="${id}-heading">${esc(LABELS[id] ?? id)}</h2>
${body}
      </section>`;

const tags = (list) =>
  !list?.length ? '' : `
              <ul class="tags">${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;

RENDERERS.about = (data) => section('about', `        <div class="prose">
${data.about.body.map((p) => `          <p>${rich(p)}</p>`).join('\n')}
        </div>`);

RENDERERS.experience = (data) => {
  const entries = data.experience.map((job) => {
    const dates = job.end ? `${esc(job.start)} — ${esc(job.end)}` : esc(job.start);
    const title = `${esc(job.role)} · ${esc(job.company)}`;
    const link = job.companyUrl
      ? `<a href="${href(job.companyUrl)}" rel="noopener noreferrer" target="_blank">${title}</a>`
      : title;
    const prior = job.priorRoles?.length
      ? `\n              <p class="entry__prior">${job.priorRoles.map(esc).join(', ')}</p>`
      : '';
    return `          <li class="entry">
            <div class="entry__date">${dates}</div>
            <div class="entry__body">
              <h3 class="entry__title">${link}</h3>${prior}
              <p class="entry__summary">${esc(job.summary)}</p>${tags(job.tags)}
            </div>
          </li>`;
  }).join('\n');

  const resume = data.meta.resume
    ? `\n        <p class="section__more"><a href="${href(data.meta.resume)}">View Full Résumé</a></p>`
    : '';

  return section('experience', `        <ol class="entries">
${entries}
        </ol>${resume}`);
};

/* ------------------------------------------------------------------ *
 * Shell renderers
 * ------------------------------------------------------------------ */

const ICONS = {
  github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>',
  linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  codepen: '<polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/><line x1="12" y1="22" x2="12" y2="15.5"/><polyline points="22 8.5 12 15.5 2 8.5"/><polyline points="2 15.5 12 8.5 22 15.5"/><line x1="12" y1="2" x2="12" y2="8.5"/>',
};

const renderHead = (meta) => {
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: meta.name,
    jobTitle: meta.title,
    description: meta.description,
    ...(meta.url ? { url: meta.url } : {}),
  }).replace(/</g, '\\u003c');

  const abs = (path) => (meta.url && path ? new URL(path, meta.url).href : path);
  const image = meta.ogImage ? `\n  <meta property="og:image" content="${esc(abs(meta.ogImage))}">` : '';

  return `  <title>${esc(meta.name)} — ${esc(meta.title)}</title>
  <meta name="description" content="${esc(meta.description)}">
  <meta name="theme-color" content="${esc(meta.themeColor ?? '#0f172a')}">
  <meta property="og:type" content="profile">
  <meta property="og:title" content="${esc(meta.name)} — ${esc(meta.title)}">
  <meta property="og:description" content="${esc(meta.description)}">${image}${meta.url ? `
  <meta property="og:url" content="${esc(meta.url)}">` : ''}
  <meta name="twitter:card" content="${meta.ogImage ? 'summary_large_image' : 'summary'}">
  <script type="application/ld+json">${jsonLd}</script>`;
};

const renderHero = (meta) => `        <h1 class="name"><a href="./">${esc(meta.name)}</a></h1>
        <p class="role">${esc(meta.title)}</p>
        <p class="tagline">${esc(meta.tagline)}</p>`;

const renderNav = (sections) => `        <nav class="nav" aria-label="Sections">
          <ul class="nav__list">
${sections.map((id, i) => `            <li><a class="nav__link" href="#${id}"${i === 0 ? ' aria-current="true"' : ''}><span class="nav__line"></span><span class="nav__label">${esc(LABELS[id] ?? id)}</span></a></li>`).join('\n')}
          </ul>
        </nav>`;

const renderSocials = (socials = []) => `      <ul class="socials">
${socials.map((s) => {
  const icon = ICONS[s.icon];
  if (!icon) console.warn(`  ! unknown social icon "${s.icon}" for ${s.label} — skipping`);
  const external = /^https?:\/\//i.test(s.url);
  const attrs = external ? ' rel="noopener noreferrer" target="_blank"' : '';
  const label = external ? `${esc(s.label)} (opens in a new tab)` : esc(s.label);
  return icon ? `        <li>
          <a href="${href(s.url)}"${attrs} aria-label="${label}">
            <svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
          </a>
        </li>` : '';
}).filter(Boolean).join('\n')}
      </ul>`;

const renderFooter = (footer) =>
  !footer?.body ? '' : `
      <footer class="footer">
        <p>${rich(footer.body)}</p>
      </footer>`;

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

/** Short content hash, appended as ?v= for cache busting. */
const fingerprint = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 8);

async function build() {
  const data = JSON.parse(await readFile(CONTENT, 'utf8'));
  await validate(data);

  const main = data.sections.map((id) => RENDERERS[id](data)).join('\n') + renderFooter(data.footer);

  let html = await readFile(join(SRC, 'index.html'), 'utf8');
  html = html
    .replace('<!--@head-->', renderHead(data.meta))
    .replace('<!--@hero-->', renderHero(data.meta))
    .replace('<!--@nav-->', renderNav(data.sections))
    .replace('<!--@socials-->', renderSocials(data.socials))
    .replace('<!--@main-->', main);

  // Empty dist/ without removing the directory itself: on Windows a dev server
  // serving dist/ holds a handle on it, and rmdir would fail with EBUSY.
  await mkdir(OUT, { recursive: true });
  for (const entry of await readdir(OUT)) {
    await rm(join(OUT, entry), { recursive: true, force: true });
  }

  // Copy sibling assets, fingerprinting their references in the HTML.
  for (const asset of ['style.css', 'main.js']) {
    const from = join(SRC, asset);
    if (!(await exists(from))) continue;
    const buffer = await readFile(from);
    await writeFile(join(OUT, asset), buffer);
    html = html.replaceAll(`"${asset}"`, `"${asset}?v=${fingerprint(buffer)}"`);
  }

  if (await exists(STATIC)) await cp(STATIC, join(OUT, 'static'), { recursive: true });

  await writeFile(join(OUT, 'index.html'), html);

  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`built dist/index.html  ${kb(Buffer.byteLength(html))}  (${data.sections.length} sections)`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
