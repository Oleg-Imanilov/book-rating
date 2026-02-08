const express = require("express");
const bcrypt = require("bcrypt");

const router = express.Router();

function run(db, sql, params = []) {
  console.log("SQL RUN", sql, params);
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
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

router.get("/register", (req, res) => {
  res.render("register", { error: null, username: "" });
});

router.post("/register", async (req, res) => {
  const db = req.app.locals.db;
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";

  if (username.length < 3 || password.length < 6) {
    return res.render("register", {
      error: "Username must be at least 3 characters and password at least 6 characters.",
      username
    });
  }

  try {
    const existing = await get(db, "SELECT id FROM users WHERE username = ?", [username]);
    if (existing) {
      return res.render("register", { error: "Username already taken.", username });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const result = await run(
      db,
      "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
      [username, passwordHash, now]
    );

    req.session.user = { id: result.lastID, username };
    return res.redirect("/");
  } catch (err) {
    return res.render("register", { error: "Registration failed.", username });
  }
});

router.get("/login", (req, res) => {
  res.render("login", { error: null, username: "" });
});

router.post("/login", async (req, res) => {
  const db = req.app.locals.db;
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";

  if (!username || !password) {
    return res.render("login", { error: "Invalid credentials.", username });
  }

  try {
    const user = await get(db, "SELECT id, username, password_hash FROM users WHERE username = ?", [
      username
    ]);

    if (!user) {
      return res.render("login", { error: "Invalid credentials.", username });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render("login", { error: "Invalid credentials.", username });
    }

    req.session.user = { id: user.id, username: user.username };
    return res.redirect("/me");
  } catch (err) {
    return res.render("login", { error: "Login failed.", username });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

module.exports = router;
