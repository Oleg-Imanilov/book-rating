const express = require("express");

const router = express.Router();

function all(db, sql, params = []) {
  console.log("SQL ALL", sql, params);
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function get(db, sql, params = []) {
  console.log("SQL GET", sql, params);
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function renderSummary(req, res) {
  const db = req.app.locals.db;

  try {
    const summary = await all(
      db,
      `SELECT b.id, b.title, b.author,
              COUNT(ub.id) as entries_count,
              COALESCE(SUM(ub.rank), 0) as rank_sum,
              ((totals.total_users - COUNT(ub.id)) * 11 + COALESCE(SUM(ub.rank), 0)) as rank_score
       FROM books b
       JOIN user_books ub ON ub.book_id = b.id
       CROSS JOIN (SELECT COUNT(*) as total_users FROM users) totals
       GROUP BY b.id
       HAVING COUNT(ub.id) >= 1
       ORDER BY rank_score ASC, b.title ASC`
    );

    const totalBooksRow = await get(db, "SELECT COUNT(*) as count FROM books");
    const totalEntriesRow = await get(db, "SELECT COUNT(*) as count FROM user_books");
    const totalRatersRow = await get(db, "SELECT COUNT(DISTINCT user_id) as count FROM user_books");

    res.render("summary", {
      summary,
      totals: {
        books: totalBooksRow ? totalBooksRow.count : 0,
        entries: totalEntriesRow ? totalEntriesRow.count : 0,
        raters: totalRatersRow ? totalRatersRow.count : 0
      },
      error: null
    });
  } catch (err) {
    res.render("summary", {
      summary: [],
      totals: { books: 0, entries: 0, raters: 0 },
      error: "Failed to load summary."
    });
  }
}

router.get("/", renderSummary);
router.get("/summary", renderSummary);

module.exports = router;
