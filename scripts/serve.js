// Zero-dependency dev server: builds the location manifest, watches
// /locations for changes, and serves the site over http:// (needed because
// fetch() of data/locations.json won't work from a file:// URL).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { build } = require('./generate-manifest');

const ROOT = path.join(__dirname, '..');
const LOCATIONS_DIR = path.join(ROOT, 'locations');
const PORT = process.env.PORT || 5500;

const MIME = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=UTF-8',
};

(async () => {
  await build().catch((err) => console.error('Build failed:', err));
  console.log(`Watching ${path.relative(ROOT, LOCATIONS_DIR)} for changes...`);
  let pending = null;
  fs.watch(LOCATIONS_DIR, { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      build().catch((err) => console.error('Build failed:', err));
    }, 200);
  });

  http
    .createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';

      const filePath = path.join(ROOT, urlPath);
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    })
    .listen(PORT, () => {
      console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
    });
})();
