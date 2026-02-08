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

function run(db, sql, params = []) {
  console.log("SQL RUN:", sql, params);
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function reorderList(db, userId, newOrderIds) {
  if (!newOrderIds.length) return;

  const rows = await all(
    db,
    "SELECT id, user_id, book_id, rank, created_at, updated_at FROM user_books WHERE user_id = ?",
    [userId]
  );
  const rowMap = new Map(rows.map((row) => [row.id, row]));
  const now = new Date().toISOString();

  const reordered = newOrderIds
    .map((id, index) => {
      const row = rowMap.get(id);
      if (!row) return null;
      return {
        ...row,
        rank: index + 1,
        updated_at: now
      };
    })
    .filter(Boolean);

  try {
    await run(db, "BEGIN TRANSACTION");
    await run(db, "DELETE FROM user_books WHERE user_id = ?", [userId]);
    for (const row of reordered) {
      await run(
        db,
        "INSERT INTO user_books (id, user_id, book_id, rank, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [row.id, row.user_id, row.book_id, row.rank, row.created_at, row.updated_at]
      );
    }
    await run(db, "COMMIT");
  } catch (err) {
    console.error("Failed to reorder list", err);
    await run(db, "ROLLBACK");
    throw err;
  }
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  return next();
}

router.get("/me", requireAuth, async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.session.user.id;
  const message = req.query.message ? String(req.query.message) : null;
  const errorFromQuery = req.query.error ? String(req.query.error) : null;

  try {
    const list = await all(
      db,
      `SELECT ub.id, ub.rank, b.title, b.author
       FROM user_books ub
       JOIN books b ON b.id = ub.book_id
       WHERE ub.user_id = ?
       ORDER BY ub.rank`,
      [userId]
    );

    const books = await all(
      db,
      `SELECT b.id, b.title, b.author
       FROM books b
       LEFT JOIN user_books ub
         ON ub.book_id = b.id AND ub.user_id = ?
       WHERE ub.id IS NULL
       ORDER BY b.title
       LIMIT 100`,
      [userId]
    );

    res.render("me", {
      list,
      books,
      error: errorFromQuery,
      message
    });
  } catch (err) {
    res.render("me", {
      list: [],
      books: [],
      error: "Failed to load your list.",
      message: null
    });
  }
});

router.post("/me/list", requireAuth, async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.session.user.id;
  const bookId = Number(req.body.book_id);

  if (!bookId) {
    return res.redirect("/me");
  }

  try {
    const now = new Date().toISOString();
    const existing = await get(
      db,
      "SELECT id FROM user_books WHERE user_id = ? AND book_id = ?",
      [userId, bookId]
    );
    if (existing) {
      return res.redirect(`/me?message=${encodeURIComponent("That book is already in your list.")}`);
    }

    const countRow = await get(
      db,
      "SELECT COUNT(*) as count FROM user_books WHERE user_id = ?",
      [userId]
    );
    const count = countRow ? countRow.count : 0;
    if (count >= 10) {
      return res.redirect(`/me?error=${encodeURIComponent("Your list already has 10 books.")}`);
    }

    const maxRankRow = await get(
      db,
      "SELECT MAX(rank) as maxRank FROM user_books WHERE user_id = ?",
      [userId]
    );
    const nextRank = (maxRankRow && maxRankRow.maxRank ? maxRankRow.maxRank : 0) + 1;

    await run(db, "BEGIN TRANSACTION");
    await run(
      db,
      `INSERT INTO user_books (user_id, book_id, rank, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, book_id) DO NOTHING`,
      [userId, bookId, nextRank, now, now]
    );
    await run(db, "COMMIT");

    return res.redirect(`/me?message=${encodeURIComponent("Added to your list.")}`);
  } catch (err) {
    await run(db, "ROLLBACK");
    return res.redirect(`/me?error=${encodeURIComponent("Failed to add book to your list.")}`);
  }
});

router.post("/me/new-book", requireAuth, async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.session.user.id;
  const title = (req.body.title || "").trim();
  const author = (req.body.author || "").trim();

  if (!title || !author) {
    return res.redirect("/me");
  }

  try {
    const now = new Date().toISOString();

    const countRow = await get(
      db,
      "SELECT COUNT(*) as count FROM user_books WHERE user_id = ?",
      [userId]
    );
    const count = countRow ? countRow.count : 0;
    if (count >= 10) {
      return res.redirect(`/me?error=${encodeURIComponent("Your list already has 10 books.")}`);
    }

    await run(db, "BEGIN TRANSACTION");
    const existingBook = await get(
      db,
      "SELECT id FROM books WHERE LOWER(title) = LOWER(?) AND LOWER(author) = LOWER(?)",
      [title, author]
    );

    if (!existingBook) {
      await run(
        db,
        "INSERT INTO books (title, author, created_by_user_id, created_at) VALUES (?, ?, ?, ?)",
        [title, author, userId, now]
      );
    }

    const book =
      existingBook ||
      (await get(db, "SELECT id FROM books WHERE LOWER(title) = LOWER(?) AND LOWER(author) = LOWER(?)", [
        title,
        author
      ]));

    if (book) {
      const existingEntry = await get(
        db,
        "SELECT id FROM user_books WHERE user_id = ? AND book_id = ?",
        [userId, book.id]
      );
      if (existingEntry) {
        await run(db, "ROLLBACK");
        return res.redirect(`/me?message=${encodeURIComponent("That book is already in your list.")}`);
      }

      const maxRankRow = await get(
        db,
        "SELECT MAX(rank) as maxRank FROM user_books WHERE user_id = ?",
        [userId]
      );
      const nextRank = (maxRankRow && maxRankRow.maxRank ? maxRankRow.maxRank : 0) + 1;

      await run(
        db,
        `INSERT INTO user_books (user_id, book_id, rank, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, book_id) DO NOTHING`,
        [userId, book.id, nextRank, now, now]
      );
    }

    await run(db, "COMMIT");
    return res.redirect(`/me?message=${encodeURIComponent("Added to your list.")}`);
  } catch (err) {
    await run(db, "ROLLBACK");
    return res.redirect(`/me?error=${encodeURIComponent("Failed to add book to your list.")}`);
  }
});


router.post("/me/list/:id/up", requireAuth, async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.session.user.id;
  const id = Number(req.params.id);

  if (!id) return res.redirect("/me");

  try {
    const rows = await all(
      db,
      "SELECT id FROM user_books WHERE user_id = ? ORDER BY rank",
      [userId]
    );
    const ids = rows.map((row) => row.id);
    const index = ids.indexOf(id);
    if (index <= 0) return res.redirect("/me");

    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    await reorderList(db, userId, ids);
    return res.redirect("/me");
  } catch (err) {
    return res.redirect("/me");
  }
});

router.post("/me/list/:id/down", requireAuth, async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.session.user.id;
  const id = Number(req.params.id);

  if (!id) return res.redirect("/me");

  try {
    const rows = await all(
      db,
      "SELECT id FROM user_books WHERE user_id = ? ORDER BY rank",
      [userId]
    );
    const ids = rows.map((row) => row.id);
    const index = ids.indexOf(id);
    if (index === -1 || index >= ids.length - 1) return res.redirect("/me");

    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    await reorderList(db, userId, ids);
    return res.redirect("/me");
  } catch (err) {
    return res.redirect("/me");
  }
});

router.post("/me/list/reorder", requireAuth, async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.session.user.id;
  const order = Array.isArray(req.body.order) ? req.body.order : [];

  if (!order.length) {
    return res.status(400).json({ error: "Missing order." });
  }

  const ids = order.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (ids.length !== order.length) {
    return res.status(400).json({ error: "Invalid order." });
  }

  try {
    const rows = await all(
      db,
      "SELECT id FROM user_books WHERE user_id = ? ORDER BY rank",
      [userId]
    );
    const existingIds = rows.map((row) => row.id);
    if (existingIds.length !== ids.length) {
      return res.status(400).json({ error: "Order length mismatch." });
    }

    const existingSet = new Set(existingIds);
    const valid = ids.every((id) => existingSet.has(id));
    if (!valid) {
      return res.status(400).json({ error: "Invalid entries." });
    }

    await reorderList(db, userId, ids);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to reorder." });
  }
});

router.post("/me/list/:id/delete", requireAuth, async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.session.user.id;
  const id = Number(req.params.id);

  if (!id) return res.redirect("/me");

  try {
    await run(db, "DELETE FROM user_books WHERE id = ? AND user_id = ?", [id, userId]);
    return res.redirect("/me");
  } catch (err) {
    return res.redirect("/me");
  }
});

module.exports = router;
