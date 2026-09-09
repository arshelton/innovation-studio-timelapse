import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("source-panoramas");
const output = path.resolve("public/panorama-manifest.json");
const extensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
function timestampFromName(name) {
  const match = name.match(
    /^IMG_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_\d{2}_\d{3}\.(?:jpe?g|png|webp)$/i,
  );
  if (!match)
    throw new Error(`Filename does not follow expected format: ${name}`);
  const [, year, month, day, hours, minutes, seconds] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );
  if (Number.isNaN(timestamp)) throw new Error(`Invalid timestamp: ${name}`);
  return timestamp;
}
const locationEntries = (await readdir(root, { withFileTypes: true })).filter(
  (e) => e.isDirectory(),
);
const locations = [];
const frames = [];
for (const entry of locationEntries) {
  const id = entry.name;
  locations.push({
    id,
    name: id
      .split(/[-_]/)
      .map((x) => x[0]?.toUpperCase() + x.slice(1))
      .join(" "),
  });
  const names = await readdir(path.join(root, id));
  for (const name of names) {
    if (!extensions.has(path.extname(name).toLowerCase())) continue;
    frames.push({
      id: `${id}:${name}`,
      locationId: id,
      timestamp: timestampFromName(name),
      imagePath: `${id}/${name}`,
    });
  }
}
frames.sort(
  (a, b) =>
    a.timestamp - b.timestamp || a.locationId.localeCompare(b.locationId),
);
locations.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(
  output,
  JSON.stringify(
    { generatedAt: new Date().toISOString(), locations, frames },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote ${frames.length} frames to ${output}`);
