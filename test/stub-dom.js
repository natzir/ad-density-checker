// A tiny DOM for running the in-page probes in Node: elements with page-coordinate boxes,
// a selector matcher for the selectors the probes use, elementFromPoint and elementsFromPoint by
// z-order (elementsFromPoint ends with body and html, as in Chrome).

const matchesSimple = (el, simple) => {
  if (simple.trim() === '*') return true;
  const presence = simple.trim().match(/^\[([\w-]+)\]$/);
  if (presence) return presence[1] in el.attrs;
  const m = simple.trim().match(/^([a-z0-9]*)(#[\w-]+)?(\.[\w-]+)?((?:\[[^\]]+\])*)$/i);
  if (!m) throw new Error(`unsupported selector: ${simple}`);
  const [, tag, id, cls, attrs] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  if (id && el.id !== id.slice(1)) return false;
  if (cls && !el.className.split(/\s+/).includes(cls.slice(1))) return false;
  for (const [, name, op, value, flag] of attrs.matchAll(/\[([\w-]+)(\*?=)"([^"]*)"\s*(i?)\]/g)) {
    let actual = name === 'class' ? el.className : name === 'id' ? el.id : el.attrs[name];
    if (actual == null) return false;
    let expected = value;
    if (flag) { actual = actual.toLowerCase(); expected = expected.toLowerCase(); }
    if (op === '=' ? actual !== expected : !actual.includes(expected)) return false;
  }
  return true;
};
const matches = (el, selector) => selector.split(',').some((s) => matchesSimple(el, s));

export function el(tag, options = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(),
    id: options.id ?? '',
    className: options.className ?? '',
    attrs: options.attrs ?? {},
    box: options.box ?? null, // { x, y, w, h } in page pixels
    style: { display: options.display ?? 'block', transform: options.transform ?? 'none', filter: 'none', perspective: 'none', position: options.position ?? 'static', top: options.top ?? 'auto', bottom: options.bottom ?? 'auto', zIndex: String(options.z ?? 0), visibility: options.visibility ?? '', opacity: '', backgroundImage: options.backgroundImage ?? 'none', backgroundColor: options.backgroundColor ?? 'rgba(0, 0, 0, 0)', backdropFilter: options.backdropFilter ?? 'none' },
    visible: options.visible ?? true,
    pointerEvents: options.pointerEvents ?? 'auto',
    ownText: options.text ?? '',
    shadowRoot: options.shadowRoot ? {} : null,
    before: options.before, // CSS content strings, e.g. '"Publicidad"'
    after: options.after,
    children,
    parentElement: null,
  };
  // Inline style set by name (kebab-case, as CSSStyleDeclaration takes it), with its priority.
  const priorities = {};
  const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  Object.defineProperties(node.style, {
    setProperty: { value: (name, value, priority = '') => { node.style[camel(name)] = value; priorities[camel(name)] = priority; } },
    getPropertyPriority: { value: (name) => priorities[camel(name)] ?? '' },
  });
  for (const child of children) child.parentElement = node;
  return node;
}

const descendants = (node) => node.children.flatMap((c) => [c, ...descendants(c)]);

export function stubPage({ width, height, scrollY = 0, pageHeight, body }) {
  const html = el('html', {}, [body]);
  const window = { innerWidth: width, innerHeight: height, scrollY };
  const all = () => [html, ...descendants(html)];
  const fixedOffset = (node) => {
    for (let n = node; n; n = n.parentElement) if (n.style.position === 'fixed') return true;
    return false;
  };
  const rectOf = (node) => {
    if (!node.box) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    const top = fixedOffset(node) ? node.box.y : node.box.y - window.scrollY;
    return { left: node.box.x, top, right: node.box.x + node.box.w, bottom: top + node.box.h, width: node.box.w, height: node.box.h };
  };
  const zOf = (node) => { let z = 0; for (let n = node; n; n = n.parentElement) z = Math.max(z, Number(n.style.zIndex)); return z; };
  for (const node of all()) {
    node.getBoundingClientRect = () => rectOf(node);
    node.contains = (other) => { for (let n = other; n; n = n.parentElement) if (n === node) return true; return false; };
    node.closest = (selector) => { for (let n = node; n; n = n.parentElement) if (matches(n, selector)) return n; return null; };
    node.querySelector = (selector) => descendants(node).find((d) => matches(d, selector)) ?? null;
    node.querySelectorAll = (selector) => descendants(node).filter((d) => matches(d, selector));
    node.checkVisibility = () => node.visible;
    node.setAttribute = (name, value) => { node.attrs[name] = String(value); };
    node.hasAttribute = (name) => name in node.attrs;
    node.getAttribute = (name) => node.attrs[name] ?? null;
    node.removeAttribute = (name) => { delete node.attrs[name]; };
    if (node.attrs.content != null) node.content = node.attrs.content;
    Object.defineProperty(node, 'textContent', {
      configurable: true,
      get: () => [node.ownText, ...node.children.map((c) => c.textContent)].join(' ').trim(),
    });
    node.nodeType = 1;
    Object.defineProperty(node, 'nextElementSibling', {
      configurable: true,
      get: () => { const kids = node.parentElement?.children ?? []; return kids[kids.indexOf(node) + 1] ?? null; },
    });
    // Its own text first, as one text node, then its elements.
    Object.defineProperty(node, 'childNodes', {
      configurable: true,
      get: () => [...(node.ownText ? [{ nodeType: 3, textContent: node.ownText }] : []), ...node.children],
    });
  }
  // The boxes at a point, top first: highest z, and among equals the last in document order (painted on top).
  const stackAt = (x, y) => all()
    .map((n, order) => ({ n, order }))
    .filter(({ n }) => {
      if (!n.box || !n.visible || n.pointerEvents === 'none') return false;
      const r = rectOf(n);
      return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    })
    .sort((a, b) => zOf(b.n) - zOf(a.n) || b.order - a.order)
    .map(({ n }) => n);
  const document = {
    body,
    documentElement: Object.assign(html, { scrollHeight: pageHeight }),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    elementFromPoint: (x, y) => stackAt(x, y)[0] ?? null,
    elementsFromPoint: (x, y) => {
      const stack = stackAt(x, y);
      return [...stack, ...[body, html].filter((n) => !stack.includes(n))];
    },
  };
  const getComputedStyle = (node, pseudo) =>
    (pseudo === '::before' ? { content: node.before ?? 'none' } : pseudo === '::after' ? { content: node.after ?? 'none' } : node.style);
  // Runs a probe the way the page would: as source text, with these globals.
  const run = (fn, ...args) =>
    new Function('window', 'document', 'getComputedStyle', `return (${fn.toString()});`)(window, document, getComputedStyle)(...args);
  return { window, document, run };
}
