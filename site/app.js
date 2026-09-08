const state = { notes: [], rendered: [], noteByName: new Map() };

const notesElement = document.querySelector("#notes");
const navigationElement = document.querySelector("#navigation");
const statusElement = document.querySelector("#status");
const searchElement = document.querySelector("#search");
const offlineButton = document.querySelector("#offline");
const resetCacheButton = document.querySelector("#reset-cache");
const previewElement = document.querySelector("#link-preview");

const slugify = (text) => text.toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function wikiLabel(raw) {
  return raw.split("|")[1] || raw.split("|")[0].split("#")[0];
}

function renderMath(source, displayMode) {
  const tex = source.replace(/\[\[([^\]]+)\]\]/g, (_, raw) => wikiLabel(raw));
  if (!window.katex) return escapeHtml(tex);
  return window.katex.renderToString(tex, { displayMode, throwOnError: false, strict: "ignore" });
}

function inline(markdown) {
  const code = [];
  const math = [];
  let value = markdown.replace(/`([^`]+)`/g, (_, text) => `\u0000${code.push(`<code>${escapeHtml(text)}</code>`) - 1}\u0000`);
  value = value.replace(/\\\((.+?)\\\)|(?<!\$)\$([^$\n]+)\$(?!\$)/g, (_, slashMath, dollarMath) => `\u0001${math.push(renderMath(slashMath || dollarMath, false)) - 1}\u0001`);
  value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, href) => `<img src="${href}" alt="${alt}">`);
  value = value.replace(/\[\[([^\]]+)\]\]/g, (_, raw) => {
    const [target, label] = raw.split("|");
    const [name, heading] = target.split("#");
    const key = name.trim().toLocaleLowerCase("uk");
    const note = state.noteByName.get(key);
    const attachment = state.attachmentByName.get(key);
    if (!note && attachment) return `<a href="${attachment}" target="_blank" rel="noreferrer">${escapeHtml(label || name)}</a>`;
    if (!note) return escapeHtml(label || raw);
    const fragment = heading ? `--${slugify(heading)}` : "";
    return `<a href="#note-${note.slug}${fragment}" data-preview-note="${note.slug}" data-preview-heading="${escapeHtml(heading || "")}">${escapeHtml(label || name)}</a>`;
  });
  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${href}"${/^https?:/.test(href) ? ' target="_blank" rel="noreferrer"' : ""}>${label}</a>`);
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return value
    .replace(/\u0000(\d+)\u0000/g, (_, index) => code[Number(index)])
    .replace(/\u0001(\d+)\u0001/g, (_, index) => math[Number(index)]);
}

function renderMarkdown(source, note) {
  const text = source.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const html = [];
  let index = 0;
  let firstHeading = true;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (line.trim() === "$$") {
      const formula = []; index += 1;
      while (index < lines.length && lines[index].trim() !== "$$") formula.push(lines[index++]);
      if (lines[index]?.trim() === "$$") index += 1;
      html.push(`<div class="math-display">${renderMath(formula.join("\n"), true)}</div>`); continue;
    }
    const oneLineFormula = line.match(/^\$\$(.+)\$\$$/);
    if (oneLineFormula) { html.push(`<div class="math-display">${renderMath(oneLineFormula[1], true)}</div>`); index += 1; continue; }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim(); const code = []; index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      index += 1; html.push(`<pre><code class="language-${escapeHtml(language)}">${escapeHtml(code.join("\n"))}</code></pre>`); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length; const label = heading[2];
      const id = firstHeading ? `note-${note.slug}--title` : `note-${note.slug}--${slugify(label)}`;
      firstHeading = false; html.push(`<h${level} id="${id}">${inline(label)}</h${level}>`); index += 1; continue;
    }
    if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line); const items = [];
      while (index < lines.length && (ordered ? /^\d+\.\s+/.test(lines[index]) : /^[-*+]\s+/.test(lines[index]))) items.push(lines[index++].replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, ""));
      html.push(`<${ordered ? "ol" : "ul"}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`); continue;
    }
    if (line.startsWith("> ")) {
      const quote = []; while (index < lines.length && lines[index].startsWith("> ")) quote.push(lines[index++].slice(2));
      const callout = quote[0]?.match(/^\[!([\w-]+)\]\s*(.*)$/);
      html.push(`<blockquote${callout ? ' class="callout"' : ""}>${callout ? `<strong>${inline(callout[2] || callout[1])}</strong>${quote.slice(1).length ? `<br>${inline(quote.slice(1).join(" "))}` : ""}` : inline(quote.join(" "))}</blockquote>`); continue;
    }
    if (/^<\/?(?:details|summary|div|table|thead|tbody|tr|th|td)[\s>]/i.test(line)) { html.push(line); index += 1; continue; }
    if (/^---+$/.test(line)) { html.push("<hr>"); index += 1; continue; }
    const paragraph = [line]; index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s|^```|^[-*+]\s+|^\d+\.\s+|^> |^<\/?(?:details|summary|div|table|thead|tbody|tr|th|td)[\s>]|^---+$/.test(lines[index])) paragraph.push(lines[index++]);
    html.push(`<p>${inline(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
  }
  return html.join("\n");
}

function renderNavigation(notes) {
  const groups = new Map();
  for (const note of notes) {
    const group = note.section || "Інше";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(note);
  }
  navigationElement.innerHTML = [...groups].map(([group, items]) => `<section><h2>${escapeHtml(group)}</h2>${items.map((note) => `<a href="#note-${note.slug}">${escapeHtml(note.title)}</a>`).join("")}</section>`).join("");
}

function routeLink(step, relation) {
  return step ? `<a href="#note-${step.slug}" data-preview-note="${step.slug}" data-preview-heading="">${relation}: ${escapeHtml(step.title)}</a>` : "";
}

function renderRoute(note) {
  if (!note.route) return "";
  const previous = routeLink(note.route.previous, "Попередній крок");
  const next = routeLink(note.route.next, "Наступний крок");
  return `<nav class="learning-route" aria-label="Маршрут навчання"><a href="#note-${note.route.moc.slug}">Маршрут: ${escapeHtml(note.route.moc.title)}</a>${previous ? `<span>← ${previous}</span>` : ""}${next ? `<span>→ ${next}</span>` : ""}</nav>`;
}

function filterNotes() {
  const query = searchElement.value.trim().toLocaleLowerCase("uk");
  for (const entry of state.rendered) {
    entry.element.hidden = Boolean(query) && !entry.searchText.includes(query);
  }
  const visible = state.rendered.filter(({ element }) => !element.hidden).length;
  statusElement.textContent = query ? `Знайдено: ${visible}` : `Нотаток: ${state.rendered.length}`;
}

function previewText(target) {
  const first = target.nextElementSibling;
  if (!first || /^H[1-6]$/.test(first.tagName)) return "Відкрити нотатку";
  return first.textContent.replace(/\s+/g, " ").trim().slice(0, 260) || "Відкрити нотатку";
}

function showPreview(link) {
  const noteSlug = link.dataset.previewNote;
  const heading = link.dataset.previewHeading;
  const target = document.querySelector(heading ? `#note-${noteSlug}--${slugify(heading)}` : `#note-${noteSlug}--title`);
  if (!target) return;
  previewElement.innerHTML = `<strong>${escapeHtml(target.textContent)}</strong><p>${escapeHtml(previewText(target))}</p>`;
  previewElement.hidden = false;
  const rect = link.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 24);
  previewElement.style.width = `${width}px`;
  previewElement.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  previewElement.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - previewElement.offsetHeight - 12)}px`;
  link.setAttribute("aria-describedby", "link-preview");
}

function hidePreview(link) {
  previewElement.hidden = true;
  link?.removeAttribute("aria-describedby");
}

function installPreviews() {
  for (const link of notesElement.querySelectorAll("a[data-preview-note]")) {
    link.addEventListener("pointerenter", () => showPreview(link));
    link.addEventListener("pointerleave", () => hidePreview(link));
    link.addEventListener("focus", () => showPreview(link));
    link.addEventListener("blur", () => hidePreview(link));
  }
}

function installConceptLinks() {
  const glossary = state.notes.find((note) => note.name === "Глосарій");
  const glossaryElement = document.querySelector(`#note-${glossary?.slug}`);
  if (!glossary || !glossaryElement) return;
  const concepts = [...glossaryElement.querySelectorAll("h3")]
    .map((heading) => ({ term: heading.textContent.trim(), href: `#${heading.id}` }))
    .filter(({ term }) => term.length >= 3)
    .sort((left, right) => right.term.length - left.term.length);
  if (!concepts.length) return;
  const escaped = concepts.map(({ term }) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const matcher = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const blocked = "A,CODE,PRE,SCRIPT,STYLE,H1,H2,H3,H4,H5,H6,SUMMARY".split(",");
  const terms = new Map(concepts.map((concept) => [concept.term.toLocaleLowerCase("uk"), concept]));

  for (const note of state.rendered) {
    if (note.element === glossaryElement) continue;
    const walker = document.createTreeWalker(note.element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const textNode of textNodes) {
      const parent = textNode.parentElement;
      if (!parent || blocked.includes(parent.tagName) || parent.closest("a, .math-display, details")) continue;
      const text = textNode.textContent;
      matcher.lastIndex = 0;
      if (!matcher.test(text)) continue;
      matcher.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of text.matchAll(matcher)) {
        const concept = terms.get(match[0].toLocaleLowerCase("uk"));
        if (!concept) continue;
        fragment.append(text.slice(offset, match.index));
        const link = document.createElement("a");
        link.className = "auto-concept";
        link.href = concept.href;
        link.dataset.previewNote = glossary.slug;
        link.dataset.previewHeading = concept.term;
        link.textContent = match[0];
        fragment.append(link);
        offset = match.index + match[0].length;
      }
      fragment.append(text.slice(offset));
      textNode.replaceWith(fragment);
    }
  }
}

async function load() {
  const manifest = await fetch("notes.json").then((response) => response.json());
  state.notes = manifest.notes;
  state.attachmentByName = new Map(Object.entries(manifest.attachments || {}).map(([name, url]) => [name.toLocaleLowerCase("uk"), url]));
  for (const note of state.notes) for (const key of [note.title, note.name, ...(note.aliases || [])]) state.noteByName.set(key.toLocaleLowerCase("uk"), note);
  renderNavigation(state.notes);
  const sources = await Promise.all(state.notes.map(async (note) => ({ note, source: await fetch(note.url).then((response) => response.text()) })));
  const fragment = document.createDocumentFragment();
  state.rendered = sources.map(({ note, source }) => {
    const element = document.createElement("section");
    element.className = "note";
    element.id = `note-${note.slug}`;
    element.innerHTML = `<p class="note-meta">${escapeHtml(note.section)}</p>${renderRoute(note)}${renderMarkdown(source, note)}`;
    fragment.append(element);
    return { element, searchText: `${note.title} ${source}`.toLocaleLowerCase("uk") };
  });
  notesElement.replaceChildren(fragment);
  installConceptLinks();
  installPreviews();
  statusElement.textContent = `Нотаток: ${state.rendered.length}`;
}

searchElement.addEventListener("input", filterNotes);

resetCacheButton.addEventListener("click", async () => {
  resetCacheButton.disabled = true;
  resetCacheButton.textContent = "Скидаю…";
  statusElement.textContent = "Скидаю кеш сайту й перезавантажую…";
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.unregister();
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter((name) => name.startsWith("f3-vault-")).map((name) => caches.delete(name)));
  } finally {
    const next = new URL(window.location.href);
    next.searchParams.set("cache-reset", Date.now());
    window.location.replace(next);
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "CACHE_COMPLETE") { offlineButton.disabled = false; offlineButton.textContent = "Збережено для офлайн"; }
    if (event.data?.type === "CACHE_FAILED") { offlineButton.disabled = false; offlineButton.textContent = "Не вдалося — спробуй ще"; }
  });
  offlineButton.addEventListener("click", async () => {
    offlineButton.disabled = true; offlineButton.textContent = "Завантажую…";
    const registration = await navigator.serviceWorker.ready;
    (registration.active || navigator.serviceWorker.controller)?.postMessage({ type: "CACHE_ALL" });
  });
} else {
  offlineButton.hidden = true;
}

load().catch(() => { statusElement.textContent = "Не вдалося завантажити матеріали."; });
