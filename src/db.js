const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const schemaPath = path.join(__dirname, "schema.sql");

function openDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  return new Pool({ connectionString });
}

async function initDb(db) {
  const schema = fs.readFileSync(schemaPath, "utf-8");
  const statements = schema
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.query(statement);
  }
}

module.exports = {
  openDb,
  initDb
};
