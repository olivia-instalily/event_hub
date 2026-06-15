// One-time helper to mint a Gmail refresh token for the single-mailbox sync.
// Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from ../.env, runs a tiny localhost
// listener, and prints (and offers to save) the refresh token after you consent.
//
//   node scripts/gmail-auth.mjs
//
// Prereq: add  http://localhost:53682  as an Authorized redirect URI on the OAuth
// client (Google Cloud → APIs & Services → Credentials → your Web client).

import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";

const ENV_PATH = new URL("../.env", import.meta.url);
const raw = readFileSync(ENV_PATH, "utf8");
const env = Object.fromEntries(
  raw.split("\n").filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const CLIENT_ID = env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env");
  process.exit(1);
}

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent" });

console.log(`\nStep 1 — make sure this is an Authorized redirect URI on your OAuth client:\n  ${REDIRECT}\n`);
console.log(`Step 2 — open this URL in your browser and approve:\n\n${authUrl}\n`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) { res.end(`Error: ${err}`); console.error("Consent error:", err); return; }
  if (!code) { res.end("Waiting for Google…"); return; }
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
    });
    const data = await r.json();
    if (data.refresh_token) {
      writeFileSync(ENV_PATH, raw.replace(/^GMAIL_REFRESH_TOKEN=.*$/m, `GMAIL_REFRESH_TOKEN=${data.refresh_token}`));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h2>Done ✅ Refresh token saved to .env — you can close this tab.</h2>");
      console.log(`\n✅ Refresh token (also written to .env):\n\n${data.refresh_token}\n`);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<pre>${JSON.stringify(data, null, 2)}</pre>`);
      console.error("\n⚠️ No refresh_token returned:\n", data, "\n(If you've consented before, revoke access at myaccount.google.com → Security → Third-party access, then retry.)");
    }
  } catch (e) {
    res.writeHead(500); res.end(String(e)); console.error(e);
  } finally {
    setTimeout(() => server.close(() => process.exit(0)), 500);
  }
});
server.listen(PORT, () => console.log(`Listening on ${REDIRECT} — waiting for the redirect…\n`));
