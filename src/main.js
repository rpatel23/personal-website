/**
 * Scroll-spy for the left-rail nav.
 *
 * Marks the nav link for whichever section you are currently reading with
 * aria-current="true". All the active styling hangs off that attribute in CSS,
 * so this file never touches classes or content.
 *
 * Without this script the first link stays marked (build.mjs renders it that
 * way), which is a reasonable no-JS default.
 */
(() => {
  const links = [...document.querySelectorAll('.nav__link')];
  if (links.length === 0) return;

  const sections = links
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);
  if (sections.length === 0) return;

  let active = null;

  const setActive = (section) => {
    if (section === active) return;
    active = section;
    for (const link of links) {
      if (link.getAttribute('href') === `#${section.id}`) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  };

  const pick = () => {
    // At the bottom of the page, the last section wins outright. A short final
    // section may never reach the activation line, and without this the last
    // nav item could never light up.
    const atBottom =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom) {
      setActive(sections[sections.length - 1]);
      return;
    }

    // Otherwise: the last section whose top has passed an imaginary line a
    // third of the way down the viewport.
    const line = window.innerHeight * 0.3;
    let current = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= line) current = section;
    }
    setActive(current);
  };

  // Called straight from the listener rather than deferred to rAF: browsers
  // already fire scroll at most once per frame, and measuring a handful of
  // sections is far cheaper than the bookkeeping. It also means the nav is
  // correct even when rAF is paused, as it is in a background tab.
  addEventListener('scroll', pick, { passive: true });
  addEventListener('resize', pick, { passive: true });
  pick();
})();
