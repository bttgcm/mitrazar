// Scans /locations and writes /data/locations.json.
// Each location folder needs an info.txt (title header + body text). The
// pin position comes from either an explicit `lat`/`lon` pair, or a
// `location` (or just `title`) place name that gets geocoded via OpenStreetMap's
// Nominatim API and cached in data/.geocode-cache.json.
// photos/ (any image files) and videos.txt (Title|URL per line) are optional.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCATIONS_DIR = path.join(ROOT, 'locations');
const OUT_FILE = path.join(ROOT, 'data', 'locations.json');
const GEOCODE_CACHE_FILE = path.join(ROOT, 'data', '.geocode-cache.json');
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif']);
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_DELAY_MS = 1100; // Nominatim's usage policy caps requests at 1/sec

function parseInfoTxt(raw) {
  const [headerBlock, ...bodyParts] = raw.split(/\r?\n---\r?\n/);
  const body = bodyParts.join('\n---\n').trim();
  const meta = {};
  headerBlock.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
  });
  return {
    title: meta.title || '',
    location: meta.location || '',
    lat: parseFloat(meta.lat),
    lon: parseFloat(meta.lon),
    body,
  };
}

function readPhotos(slug, dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => `locations/${slug}/photos/${f}`);
}

function readVideos(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [title, url] = l.split('|').map((s) => (s || '').trim());
      return { title: title || 'Video', url };
    })
    .filter((v) => v.url);
}

function loadGeocodeCache() {
  if (!fs.existsSync(GEOCODE_CACHE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(GEOCODE_CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveGeocodeCache(cache) {
  fs.mkdirSync(path.dirname(GEOCODE_CACHE_FILE), { recursive: true });
  fs.writeFileSync(GEOCODE_CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function geocode(query, cache) {
  if (cache[query]) return cache[query];

  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MitraAzarPortfolioSite-build-script (local dev, contact: n/a)' },
  });
  if (!res.ok) throw new Error(`Nominatim request failed (HTTP ${res.status})`);
  const results = await res.json();
  if (!results.length) throw new Error('no geocoding match');

  const coords = { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
  cache[query] = coords;
  saveGeocodeCache(cache);
  await new Promise((resolve) => setTimeout(resolve, NOMINATIM_DELAY_MS));
  return coords;
}

async function resolveCoords(entry, slug, cache) {
  if (!Number.isNaN(entry.lat) && !Number.isNaN(entry.lon)) {
    return { lat: entry.lat, lon: entry.lon };
  }
  const query = entry.location || entry.title;
  if (!query) {
    console.warn(`Skipping "${slug}": no lat/lon and no title/location to geocode`);
    return null;
  }
  try {
    const coords = await geocode(query, cache);
    console.log(`Geocoded "${query}" -> ${coords.lat}, ${coords.lon}`);
    return coords;
  } catch (err) {
    console.warn(`Skipping "${slug}": geocoding "${query}" failed (${err.message})`);
    return null;
  }
}

async function build() {
  if (!fs.existsSync(LOCATIONS_DIR)) {
    console.error(`No locations directory at ${LOCATIONS_DIR}`);
    return;
  }

  const slugs = fs
    .readdirSync(LOCATIONS_DIR)
    .filter((f) => fs.statSync(path.join(LOCATIONS_DIR, f)).isDirectory());

  const geocodeCache = loadGeocodeCache();
  const locations = [];

  for (const slug of slugs) {
    const dir = path.join(LOCATIONS_DIR, slug);
    const infoPath = path.join(dir, 'info.txt');
    if (!fs.existsSync(infoPath)) {
      console.warn(`Skipping "${slug}": no info.txt`);
      continue;
    }

    const entry = parseInfoTxt(fs.readFileSync(infoPath, 'utf8'));
    const coords = await resolveCoords(entry, slug, geocodeCache);
    if (!coords) continue;

    locations.push({
      slug,
      title: entry.title || slug,
      lat: coords.lat,
      lon: coords.lon,
      body: entry.body,
      photos: readPhotos(slug, path.join(dir, 'photos')),
      videos: readVideos(path.join(dir, 'videos.txt')),
    });
  }

  locations.sort((a, b) => a.title.localeCompare(b.title));

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(locations, null, 2));
  console.log(`Wrote ${locations.length} location(s) to ${path.relative(ROOT, OUT_FILE)}`);
}

async function watch() {
  await build().catch((err) => console.error('Build failed:', err));
  console.log(`Watching ${path.relative(ROOT, LOCATIONS_DIR)} for changes...`);
  let pending = null;
  fs.watch(LOCATIONS_DIR, { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      build().catch((err) => console.error('Build failed:', err));
    }, 200);
  });
}

if (require.main === module) {
  const run = process.argv.includes('--watch') ? watch : build;
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { build };
