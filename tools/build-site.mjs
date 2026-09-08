import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");
const output = path.join(root, "_site");
const ignored = new Set([".git", ".github", ".obsidian", "site", "tools", "_site", "_templates", "node_modules"]);

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function titleFrom(markdown, fallback) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "").match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function aliasesFrom(markdown) {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/s)?.[1] || "";
  const inline = frontmatter.match(/^aliases:\s*\[([^\]]*)\]$/m)?.[1];
  return inline ? inline.split(",").map((value) => value.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean) : [];
}

function slugify(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

const allFiles = await walk(root);
const markdownFiles = allFiles.filter((file) => path.extname(file).toLowerCase() === ".md");
const attachments = allFiles.filter((file) => [".pdf", ".docx"].includes(path.extname(file).toLowerCase()));

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "notes"), { recursive: true });
await cp(site, output, { recursive: true });
await mkdir(path.join(output, "vendor", "katex"), { recursive: true });
await cp(path.join(root, "node_modules", "katex", "dist", "katex.min.css"), path.join(output, "vendor", "katex", "katex.min.css"));
await cp(path.join(root, "node_modules", "katex", "dist", "katex.min.js"), path.join(output, "vendor", "katex", "katex.min.js"));
await cp(path.join(root, "node_modules", "katex", "dist", "fonts"), path.join(output, "vendor", "katex", "fonts"), { recursive: true });

const notes = [];
for (const file of markdownFiles) {
  const relative = path.relative(root, file);
  const markdown = await readFile(file, "utf8");
  const destination = path.join(output, "notes", relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(file, destination);
  const name = path.basename(relative, ".md");
  notes.push({
    name,
    title: titleFrom(markdown, name),
    aliases: aliasesFrom(markdown),
    section: path.dirname(relative) === "." ? "Навігація" : path.dirname(relative),
    slug: slugify(relative),
    url: `notes/${relative.split(path.sep).map(encodeURIComponent).join("/")}`,
  });
}
const attachmentMap = {};
for (const file of attachments) {
  const relative = path.relative(root, file);
  const destination = path.join(output, "notes", relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(file, destination);
  attachmentMap[path.basename(relative).toLocaleLowerCase("uk")] = `notes/${relative.split(path.sep).map(encodeURIComponent).join("/")}`;
}
notes.sort((a, b) => a.section.localeCompare(b.section, "uk") || a.title.localeCompare(b.title, "uk"));
await writeFile(path.join(output, "notes.json"), JSON.stringify({ notes, attachments: attachmentMap }, null, 2));

const deployFiles = await walk(output);
const assets = deployFiles.map((file) => `./${path.relative(output, file).split(path.sep).map(encodeURIComponent).join("/")}`);
assets.push("./");
const buildId = createHash("sha1").update(await Promise.all(deployFiles.map((file) => readFile(file))).then((chunks) => Buffer.concat(chunks))).digest("hex").slice(0, 12);
const serviceWorker = (await readFile(path.join(site, "sw.js"), "utf8"))
  .replace("__BUILD_ID__", buildId)
  .replace("__ASSETS__", JSON.stringify(assets));
await writeFile(path.join(output, "sw.js"), serviceWorker);

const outputSize = (await Promise.all((await walk(output)).map(async (file) => (await stat(file)).size))).reduce((sum, size) => sum + size, 0);
console.log(`Built ${notes.length} notes and ${attachments.length} attachments (${Math.round(outputSize / 1024)} KiB).`);
