const express = require("express");

const router = express.Router();

function all(db, sql, params = []) {
  console.log("SQL ALL", sql, params);
  return db.query(sql, params).then((result) => result.rows);
}

function run(db, sql, params = []) {
  console.log("SQL RUN", sql, params);
  return db.query(sql, params);
}

function get(db, sql, params = []) {
  console.log("SQL GET", sql, params);
  return db.query(sql, params).then((result) => result.rows[0] || null);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  return next();
}

router.get("/books", async (req, res) => {
  const db = req.app.locals.db;
  const query = (req.query.q || "").trim();
  const editId = req.query.edit ? Number(req.query.edit) : null;
  const message = req.query.message ? String(req.query.message) : null;
  const errorFromQuery = req.query.error ? String(req.query.error) : null;

  try {
    const like = `%${query}%`;
    const books = await all(
      db,
      query
        ? "SELECT id, title, author FROM books WHERE title ILIKE $1 OR author ILIKE $2 ORDER BY title"
        : "SELECT id, title, author FROM books ORDER BY title",
      query ? [like, like] : []
    );

    res.render("books", {
      books,
      query,
      editId,
      error: errorFromQuery,
      message
    });
  } catch (err) {
    res.render("books", {
      books: [],
      query,
      editId,
      error: "Failed to load books.",
      message: null
    });
  }
});

router.post("/books/:id/fix", requireAuth, async (req, res) => {
  const db = req.app.locals.db;
  const bookId = Number(req.params.id);
  const title = (req.body.title || "").trim();
  const author = (req.body.author || "").trim();
  const query = (req.body.q || "").trim();
  const querySuffix = query ? `&q=${encodeURIComponent(query)}` : "";

  if (!bookId) {
    return res.redirect(`/books?error=${encodeURIComponent("Book not found.")}${querySuffix}`);
  }

  if (!title || !author) {
    return res.redirect(
      `/books?error=${encodeURIComponent("Title and author are required.")}&edit=${bookId}${querySuffix}`
    );
  }

  try {
    const existing = await get(
      db,
      "SELECT id FROM books WHERE LOWER(title) = LOWER($1) AND LOWER(author) = LOWER($2) AND id != $3",
      [title, author, bookId]
    );

    if (existing) {
      return res.redirect(
        `/books?message=${encodeURIComponent("That book already exists in the pool.")}&edit=${bookId}${querySuffix}`
      );
    }

    const target = await get(db, "SELECT id FROM books WHERE id = $1", [bookId]);
    if (!target) {
      return res.redirect(`/books?error=${encodeURIComponent("Book not found.")}${querySuffix}`);
    }

    await run(db, "UPDATE books SET title = $1, author = $2 WHERE id = $3", [title, author, bookId]);

    return res.redirect(`/books?message=${encodeURIComponent("Book updated.")}${querySuffix}`);
  } catch (err) {
    return res.redirect(`/books?error=${encodeURIComponent("Failed to update book.")}&edit=${bookId}${querySuffix}`);
  }
});

router.post("/books", requireAuth, async (req, res) => {
  const db = req.app.locals.db;
  const title = (req.body.title || "").trim();
  const author = (req.body.author || "").trim();

  if (!title || !author) {
    return res.redirect(`/books?error=${encodeURIComponent("Title and author are required.")}`);
  }

  try {
    const existing = await get(
      db,
      "SELECT id FROM books WHERE LOWER(title) = LOWER($1) AND LOWER(author) = LOWER($2)",
      [title, author]
    );

    if (existing) {
      return res.redirect(`/books?message=${encodeURIComponent("That book already exists in the pool.")}`);
    }

    const now = new Date().toISOString();
    await run(
      db,
      "INSERT INTO books (title, author, created_by_user_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (title, author) DO NOTHING",
      [title, author, req.session.user.id, now]
    );

    return res.redirect(`/books?message=${encodeURIComponent("Book added to the pool.")}`);
  } catch (err) {
    return res.redirect(`/books?error=${encodeURIComponent("Failed to add book.")}`);
  }
});

module.exports = router;
