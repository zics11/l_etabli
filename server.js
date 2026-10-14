// L'Établi : petit serveur autonome, sans dépendance (Node 22+).
// Sert la page et enregistre les projets dans data/etabli.db (SQLite).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT) || 4815;
const DATA_DIR = path.join(__dirname, "data");
const PAGE = path.join(__dirname, "public", "index.html");

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "etabli.db"));
db.exec("CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, data TEXT NOT NULL)");

const all = () => db.prepare("SELECT id, data FROM items").all()
  .map(r => Object.assign(JSON.parse(r.data), { id: r.id }));
const getOne = db.prepare("SELECT data FROM items WHERE id = ?");
const upsert = db.prepare("INSERT INTO items (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data");
const remove = db.prepare("DELETE FROM items WHERE id = ?");

// Chaque page ouverte reçoit la liste complète à chaque changement
const clients = new Set();
function broadcast() {
  const msg = "data: " + JSON.stringify(all()) + "\n\n";
  for (const res of clients) res.write(msg);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
  });
}

const send = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const m = url.pathname.match(/^\/api\/items\/([A-Za-z0-9_-]{1,64})$/);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(PAGE).pipe(res);
    } else if (req.method === "GET" && url.pathname === "/api/items") {
      send(res, 200, all());
    } else if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write("data: " + JSON.stringify(all()) + "\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    } else if (req.method === "PUT" && m) {
      // Crée l'élément ou fusionne les champs reçus
      const patch = await readBody(req);
      delete patch.id;
      const row = getOne.get(m[1]);
      upsert.run(m[1], JSON.stringify(Object.assign(row ? JSON.parse(row.data) : {}, patch)));
      send(res, 200, { ok: true });
      broadcast();
    } else if (req.method === "DELETE" && m) {
      remove.run(m[1]);
      send(res, 200, { ok: true });
      broadcast();
    } else {
      send(res, 404, { error: "not_found" });
    }
  } catch (e) {
    send(res, 400, { error: "bad_request" });
  }
}).listen(PORT, () => console.log("L'Établi : http://localhost:" + PORT));
