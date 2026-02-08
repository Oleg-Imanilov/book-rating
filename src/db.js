const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

let dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
let dbPath = path.join(dataDir, "app.sqlite");
const schemaPath = path.join(__dirname, "schema.sql");

function applyDataDir(nextDir) {
  dataDir = nextDir;
  dbPath = path.join(dataDir, "app.sqlite");
}

function ensureDataDir() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    return dataDir;
  } catch (err) {
    const fallbackErrors = new Set(["EROFS", "EACCES", "EPERM", "ENOENT"]);
    if (!fallbackErrors.has(err.code)) {
      throw err;
    }

    const tmpBase =
      process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp";
    const fallbackDir = path.join(tmpBase, "books-rating-data");
    fs.mkdirSync(fallbackDir, { recursive: true });
    applyDataDir(fallbackDir);
    return dataDir;
  }
}

function getDataDir() {
  return ensureDataDir();
}

function getDbPath() {
  ensureDataDir();
  return dbPath;
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
  dbPath,
  getDbPath,
  getDataDir
};
