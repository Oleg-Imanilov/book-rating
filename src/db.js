const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "app.sqlite");
const schemaPath = path.join(__dirname, "schema.sql");

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function openDb() {
  ensureDataDir();
  return new sqlite3.Database(dbPath);
}

function initDb(db) {
  const schema = fs.readFileSync(schemaPath, "utf-8");
  return new Promise((resolve, reject) => {
    db.exec(schema, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = {
  openDb,
  initDb,
  dbPath
};
