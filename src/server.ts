import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import routes from './routes';

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

// Railway (and most PaaS hosts) sit behind a reverse proxy that sets
// X-Forwarded-For. Without this, Express doesn't trust that header, and
// express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every
// /api request — which was breaking requests before they ever reached the
// route handlers (senshi servers/embeds included). `1` trusts exactly one
// hop (the platform's own proxy), which is correct for Railway's setup.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '60'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});
app.use('/api', limiter);

// API routes
app.use('/api', routes);

// ── Index page password protection ──────────────────────────────────────────
// Set INDEX_PASSWORD in Railway → Variables to enable.
// If unset, the index page is publicly accessible.
const INDEX_PASSWORD = process.env.INDEX_PASSWORD;

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AniVault – Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f0f13;
      font-family: system-ui, -apple-system, sans-serif;
      color: #e2e8f0;
    }
    .card {
      background: #1a1a24;
      border: 1px solid #2d2d3d;
      border-radius: 12px;
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 360px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.4rem; color: #f8fafc; }
    p  { font-size: 0.85rem; color: #64748b; margin-bottom: 1.8rem; }
    label { display: block; font-size: 0.8rem; color: #94a3b8; margin-bottom: 0.4rem; }
    input {
      width: 100%;
      padding: 0.6rem 0.85rem;
      background: #0f0f13;
      border: 1px solid #2d2d3d;
      border-radius: 8px;
      color: #e2e8f0;
      font-size: 1rem;
      outline: none;
      transition: border-color .2s;
    }
    input:focus { border-color: #6366f1; }
    button {
      margin-top: 1.2rem;
      width: 100%;
      padding: 0.65rem;
      background: #6366f1;
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: background .2s;
    }
    button:hover { background: #4f46e5; }
    .error {
      margin-top: 1rem;
      padding: 0.55rem 0.75rem;
      background: #3b1212;
      border: 1px solid #7f1d1d;
      border-radius: 6px;
      font-size: 0.82rem;
      color: #fca5a5;
      display: none;
    }
    .error.show { display: block; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 AniVault API</h1>
    <p>Enter the password to access the docs &amp; tester.</p>
    <label for="pwd">Password</label>
    <input type="password" id="pwd" placeholder="••••••••" autofocus />
    <button onclick="login()">Unlock</button>
    <div class="error" id="err">Incorrect password. Try again.</div>
  </div>
  <script>
    document.getElementById('pwd').addEventListener('keydown', e => {
      if (e.key === 'Enter') login();
    });
    function login() {
      const pwd = document.getElementById('pwd').value;
      fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      }).then(r => {
        if (r.ok) { window.location.reload(); }
        else { document.getElementById('err').classList.add('show'); }
      });
    }
  </script>
</body>
</html>`;

// Simple in-memory session store
const activeSessions = new Set<string>();

function generateToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Parse cookies without any external dependency
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k.trim(), decodeURIComponent(v.join('='))];
    })
  );
}

// Login endpoint
app.post('/auth/login', (req, res) => {
  if (!INDEX_PASSWORD) return res.status(200).json({ ok: true });
  const { password } = req.body ?? {};
  if (password === INDEX_PASSWORD) {
    const token = generateToken();
    activeSessions.add(token);
    res.setHeader('Set-Cookie', `av_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid password' });
});

// Logout endpoint
app.get('/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).av_session;
  if (token) activeSessions.delete(token);
  res.setHeader('Set-Cookie', 'av_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.redirect('/');
});

// Middleware: protect index page when INDEX_PASSWORD is set
function indexGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!INDEX_PASSWORD) return next();
  const token = parseCookies(req.headers.cookie).av_session;
  if (token && activeSessions.has(token)) return next();
  return res.status(401).send(LOGIN_PAGE);
}

// Serve static docs/tester (protected)
app.use(indexGuard, express.static(path.join(__dirname, '../public')));

// Catch-all → docs (protected)
app.get('*', indexGuard, (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🟢 AniVault API running on http://localhost:${PORT}`);
  console.log(`📄 Docs + Tester: http://localhost:${PORT}/`);
  console.log(`🔗 API base:      http://localhost:${PORT}/api\n`);
});

export default app;
