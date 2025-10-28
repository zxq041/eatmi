 // server.js
const express = require('express');
const path = require('path');
const compression = require('compression');

const app = express();
const ROOT = __dirname;               // katalog z index.html, sw.js, manifestem i icons/
const PORT = process.env.PORT || 3000;

// Kompresja (gzip/br)
app.use(compression());

// Właściwy typ MIME dla webmanifest
app.use((req, res, next) => {
  if (req.path.endsWith('.webmanifest')) {
    res.type('application/manifest+json; charset=utf-8');
  }
  next();
});

// Serwuj service workera z poprawnym zakresem
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(ROOT, 'sw.js'), {
    headers: {
      // umożliwia SW działanie w całym scope '/'
      'Service-Worker-Allowed': '/'
    }
  });
});

// Statyczne pliki z sensownym cache (index.html bez cache, reszta z max-age)
app.use(express.static(ROOT, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      // zawsze pobieraj świeży index
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      // lekkie cache dla assetów
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// SPA fallback: wszystko inne kieruj do index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`eatmi server listening on http://localhost:${PORT}`);
});
