// Anmeldung für den Redaktionseditor mit Benutzername und Passwort.
// Spricht das OAuth-Popup-Protokoll von Decap/Sveltia CMS: nach erfolgreicher
// Anmeldung erhält der Editor den GitHub-Schlüssel aus der Umgebungsvariable
// GITHUB_TOKEN. Die Benutzer stehen in EDITOR_USERS («name:passwort;name2:passwort2»).
const crypto = require('crypto');

const page = (body) => `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Anmeldung · Redaktion</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F2F2;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#15171C}
  form{width:min(360px,92vw);background:#fff;border-radius:18px;padding:28px;box-shadow:0 20px 50px -30px rgba(0,0,0,.4)}
  h1{font-size:1.3rem;margin:0 0 4px} p{margin:0 0 16px;color:#474D57;font-size:.92rem}
  label{display:block;font-weight:700;font-size:.88rem;margin:12px 0 4px}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #CBD0D7;border-radius:10px;font:inherit}
  button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:999px;background:#2559A1;color:#fff;font:inherit;font-weight:700;cursor:pointer}
  .err{color:#9C2B1C;font-weight:700;margin-top:12px}
</style></head><body>${body}</body></html>`;

const form = (msg = '') => page(`<form method="post" action="/api/auth">
  <h1>Redaktion</h1><p>Compétences interculturelles et ÉDD</p>
  <label for="u">Benutzername</label><input id="u" name="username" autocomplete="username" required autofocus>
  <label for="p">Passwort</label><input id="p" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Anmelden</button>${msg ? `<p class="err">${msg}</p>` : ''}</form>`);

const success = (token) => page(`<p>Angemeldet – dieses Fenster schliesst sich.</p><script>
  (function () {
    var msg = 'authorization:github:success:' + JSON.stringify({ token: ${JSON.stringify(token)}, provider: 'github' });
    function receive(e) { window.opener.postMessage(msg, e.origin); window.removeEventListener('message', receive, false); setTimeout(function () { window.close(); }, 300); }
    window.addEventListener('message', receive, false);
    window.opener.postMessage('authorizing:github', '*');
  })();
</script>`);

function users() {
  return String(process.env.EDITOR_USERS || '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf(':');
    return { name: s.slice(0, i).trim(), pass: s.slice(i + 1) };
  }).filter((u) => u.name && u.pass);
}
function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (!raw) { for await (const chunk of req) raw += chunk; }
  return Object.fromEntries(new URLSearchParams(raw));
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') { res.statusCode = 200; return res.end(form()); }
  const token = process.env.GITHUB_TOKEN;
  const list = users();
  if (!token || !list.length) { res.statusCode = 500; return res.end(form('Die Anmeldung ist noch nicht eingerichtet (Umgebungsvariablen fehlen).')); }
  const { username = '', password = '' } = await readBody(req);
  let ok = false;
  for (const u of list) if (same(u.name.toLowerCase(), String(username).trim().toLowerCase()) & same(u.pass, password)) ok = true;
  if (!ok) { await new Promise((r) => setTimeout(r, 900)); res.statusCode = 401; return res.end(form('Benutzername oder Passwort stimmt nicht.')); }
  res.statusCode = 200;
  return res.end(success(token));
};
