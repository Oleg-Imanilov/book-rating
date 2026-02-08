const express = require("express");

const router = express.Router();

function all(db, sql, params = []) {
  console.log("SQL ALL", sql, params);
  return db.query(sql, params).then((result) => result.rows);
}

function get(db, sql, params = []) {
  console.log("SQL GET", sql, params);
  return db.query(sql, params).then((result) => result.rows[0] || null);
}

function run(db, sql, params = []) {
  console.log("SQL RUN:", sql, params);
  return db.query(sql, params);
}

async function reorderList(db, userId, newOrderIds) {
  if (!newOrderIds.length) return;

  const rows = await all(
    db,
    "SELECT id, user_id, book_id, rank, created_at, updated_at FROM user_books WHERE user_id = $1",
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
    await run(db, "BEGIN");
    await run(db, "DELETE FROM user_books WHERE user_id = $1", [userId]);
    for (const row of reordered) {
      await run(
        db,
        "INSERT INTO user_books (id, user_id, book_id, rank, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
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
       WHERE ub.user_id = $1
       ORDER BY ub.rank`,
      [userId]
    );

    const books = await all(
      db,
      `SELECT b.id, b.title, b.author
       FROM books b
       LEFT JOIN user_books ub
         ON ub.book_id = b.id AND ub.user_id = $1
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
      "SELECT id FROM user_books WHERE user_id = $1 AND book_id = $2",
      [userId, bookId]
    );
    if (existing) {
      return res.redirect(`/me?message=${encodeURIComponent("That book is already in your list.")}`);
    }

    const countRow = await get(
      db,
      "SELECT COUNT(*) as \"count\" FROM user_books WHERE user_id = $1",
      [userId]
    );
    const count = Number(countRow ? countRow.count : 0);
    if (count >= 10) {
      return res.redirect(`/me?error=${encodeURIComponent("Your list already has 10 books.")}`);
    }

    const maxRankRow = await get(
      db,
      "SELECT MAX(rank) as \"maxRank\" FROM user_books WHERE user_id = $1",
      [userId]
    );
    const nextRank = (maxRankRow && maxRankRow.maxRank ? Number(maxRankRow.maxRank) : 0) + 1;

    const client = await db.connect();
    try {
      await run(client, "BEGIN");
      await run(
        client,
        `INSERT INTO user_books (user_id, book_id, rank, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(user_id, book_id) DO NOTHING`,
        [userId, bookId, nextRank, now, now]
      );
      await run(client, "COMMIT");
    } catch (err) {
      await run(client, "ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return res.redirect(`/me?message=${encodeURIComponent("Added to your list.")}`);
  } catch (err) {
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
      "SELECT COUNT(*) as \"count\" FROM user_books WHERE user_id = $1",
      [userId]
    );
    const count = Number(countRow ? countRow.count : 0);
    if (count >= 10) {
      return res.redirect(`/me?error=${encodeURIComponent("Your list already has 10 books.")}`);
    }

    const client = await db.connect();
    try {
      await run(client, "BEGIN");
      const existingBook = await get(
        client,
        "SELECT id FROM books WHERE LOWER(title) = LOWER($1) AND LOWER(author) = LOWER($2)",
        [title, author]
      );

      if (!existingBook) {
        await run(
          client,
          "INSERT INTO books (title, author, created_by_user_id, created_at) VALUES ($1, $2, $3, $4)",
          [title, author, userId, now]
        );
      }

      const book =
        existingBook ||
        (await get(client, "SELECT id FROM books WHERE LOWER(title) = LOWER($1) AND LOWER(author) = LOWER($2)", [
          title,
          author
        ]));

      if (book) {
        const existingEntry = await get(
          client,
          "SELECT id FROM user_books WHERE user_id = $1 AND book_id = $2",
          [userId, book.id]
        );
        if (existingEntry) {
          await run(client, "ROLLBACK");
          return res.redirect(`/me?message=${encodeURIComponent("That book is already in your list.")}`);
        }

        const maxRankRow = await get(
          client,
          "SELECT MAX(rank) as \"maxRank\" FROM user_books WHERE user_id = $1",
          [userId]
        );
        const nextRank = (maxRankRow && maxRankRow.maxRank ? Number(maxRankRow.maxRank) : 0) + 1;

        await run(
          client,
          `INSERT INTO user_books (user_id, book_id, rank, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT(user_id, book_id) DO NOTHING`,
          [userId, book.id, nextRank, now, now]
        );
      }

      await run(client, "COMMIT");
    } catch (err) {
      await run(client, "ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return res.redirect(`/me?message=${encodeURIComponent("Added to your list.")}`);
  } catch (err) {
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
      "SELECT id FROM user_books WHERE user_id = $1 ORDER BY rank",
      [userId]
    );
    const ids = rows.map((row) => row.id);
    const index = ids.indexOf(id);
    if (index <= 0) return res.redirect("/me");

    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    const client = await db.connect();
    try {
      await reorderList(client, userId, ids);
    } finally {
      client.release();
    }
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
      "SELECT id FROM user_books WHERE user_id = $1 ORDER BY rank",
      [userId]
    );
    const ids = rows.map((row) => row.id);
    const index = ids.indexOf(id);
    if (index === -1 || index >= ids.length - 1) return res.redirect("/me");

    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    const client = await db.connect();
    try {
      await reorderList(client, userId, ids);
    } finally {
      client.release();
    }
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
      "SELECT id FROM user_books WHERE user_id = $1 ORDER BY rank",
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

    const client = await db.connect();
    try {
      await reorderList(client, userId, ids);
    } finally {
      client.release();
    }
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
    await run(db, "DELETE FROM user_books WHERE id = $1 AND user_id = $2", [id, userId]);
    return res.redirect("/me");
  } catch (err) {
    return res.redirect("/me");
  }
});

module.exports = router;
