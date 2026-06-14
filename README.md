# AniVault API

A unified anime streaming scraper API — returns embed URLs and m3u8 streams addressed by **MAL or AniList ID**. Built for AniVault, deployable on Railway in one click.

---

## Quick Start

```bash
git clone <your-repo>
cd anivault-api
npm install
cp .env.example .env
npm run dev
# → http://localhost:3000
```

Open `http://localhost:3000` for the interactive docs + tester.

---


## Deploy on Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repo — Railway auto-detects Node.js via `railway.toml`
4. Set environment variables (optional, see `.env.example`)
5. Done — your API is live at `https://your-app.up.railway.app`

---

## API Endpoints

### `GET /api/search?q=naruto`
Search anime by title via AniList.

### `GET /api/info?anilistId=20`
Get anime metadata and site-specific IDs.
- `?malId=21` — use MAL ID instead

### `GET /api/episodes?anilistId=20&source=senshi`
Get full episode list from a source.
- `source`: `senshi` | `dao` | `wave` | `animeheaven` (default: `senshi`)

### `GET /api/servers?anilistId=20&ep=1&type=sub&source=senshi`
Get all available servers for an episode before fetching a stream.

### `GET /api/watch/{source}/{id}/{ep}/{type}`
Get embed URL plus m3u8 or direct MP4 for an episode.

```
GET /api/watch/senshi/20/1/sub
GET /api/watch/dao/mal-21/5/dub
GET /api/watch/wave/1535/12/sub?server=Vidstreaming
GET /api/watch/animeheaven/{heavenId}/3/sub
GET /api/watch?source=animeheaven&heavenId={heavenId}&ep=3&type=sub
```

**`id`** can be:
- `20` — AniList ID (default)
- `mal-21` — MAL ID with `mal-` prefix

**Query params:**
- `?server=Megacloud` — preferred server name (optional)

**Response:**
```json
{
  "anilistId": 20,
  "malId": 20,
  "title": "Naruto",
  "episode": 1,
  "type": "sub",
  "source": "senshi",
  "server": "Megacloud",
  "availableServers": ["Megacloud", "Vidstreaming"],
  "embedUrl": "https://megacloud.blog/embed-2/e-1/AbCdEf",
  "m3u8": "https://cdn.megacloud.blog/hls/abc/master.m3u8",
  "subtitles": [{ "lang": "English", "url": "https://.../en.vtt", "default": true }],
  "intro": { "start": 0, "end": 90 },
  "outro": { "start": 1350, "end": 1440 },
  "note": null
}
```

> If `m3u8` is null, check `mp4` / `streamUrl` first. Some sources, including AnimeHeaven, expose direct MP4 instead of HLS.

### `GET /api/health`
Server health, uptime, and cache stats.

---

## Sources

| Key | Site | Type | Notes |
|---|---|---|---|
| `senshi` | senshi.live | Zoro-style | Verify CSS selectors |
| `wave` | aniwaves.ru | Zoro-style | Verify CSS selectors |
| `dao` | anidao.to | Zoro-style | Verify CSS selectors |
| `animeheaven` | animeheaven.me | Direct MP4 source | Returns direct MP4 sources; no HLS on current site |

---

## Using in AniVault (PHP)

```php
// Option A — iframe embed (easiest)
$api = 'https://your-app.up.railway.app';
$malId = 21; // from your DB
$ep = 1;

$response = file_get_contents("{$api}/api/watch/senshi/mal-{$malId}/{$ep}/sub");
$data = json_decode($response, true);

echo "<iframe src='{$data['embedUrl']}' allowfullscreen></iframe>";

// Option B — HLS.js with m3u8
if ($data['m3u8']) {
    echo "<script>
        var hls = new Hls();
        hls.loadSource('{$data['m3u8']}');
        hls.attachMedia(document.getElementById('video'));
    </script>";
}
```

---

## Important Notes

### Selectors Need Verification
All three Zoro-style scrapers (senshi, wave, dao) use CSS selectors reverse-engineered from the HiAnime pattern. **You must open each site in DevTools, inspect the episode/server buttons, and update selectors in:**
- `src/scrapers/senshi.ts`
- `src/scrapers/aniwaves.ts`
- `src/scrapers/anidao.ts`

### Megacloud AES Keys Rotate
When m3u8 stops decrypting, the keys have changed. Check:
[github.com/ghoshRitesh12/aniwatch-api](https://github.com/ghoshRitesh12/aniwatch-api/blob/main/src/extractors/megacloud.ts)

Update `src/resolvers/megacloud.ts`:
```typescript
const KEYS = {
  megacloud: {
    key: CryptoJS.enc.Utf8.parse('NEW_KEY_HERE'),
    iv:  CryptoJS.enc.Utf8.parse('NEW_IV_HERE'),
  },
  ...
}
```

### ID Mapping via Anify
Site-specific IDs come from `api.anify.tv`. If Anify is down, the `/api/watch` endpoint will fall back to AniList for title only and return 404 for sources.

---

## Project Structure

```
src/
  server.ts          ← Express entry point
  routes.ts          ← All API route handlers
  scrapers/
    senshi.ts        ← senshi.live scraper
    aniwaves.ts      ← aniwaves.ru scraper
    anidao.ts        ← anidao.to scraper
    animeheaven.ts     ← animeheaven.me scraper
  resolvers/
    megacloud.ts     ← Megacloud/Vidstreaming AES decryptor
  utils/
    cache.ts         ← In-memory cache (node-cache)
    fetch.ts         ← Axios clients with spoofed headers
    mapper.ts        ← MAL/AniList ID → site-specific ID mapping
public/
  index.html         ← Interactive docs + API tester
```

---

## Development

```bash
npm run dev       # ts-node-dev with hot reload
npm run build     # compile TypeScript
npm start         # run compiled JS
```

Cache TTLs (configurable via `.env`):
- ID mappings: 24h
- Episode lists: 1h
- Stream URLs: 5min

---

*Educational project. For personal use only.*

