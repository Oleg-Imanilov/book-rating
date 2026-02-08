const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(process.cwd(), ".env.development.local") });
const express = require("express");
const session = require("express-session");
const { openDb, initDb } = require("./db");
const PgSession = require("connect-pg-simple")(session);
const authRoutes = require("./routes/auth");
const bookRoutes = require("./routes/books");
const meRoutes = require("./routes/me");
const summaryRoutes = require("./routes/summary");

const app = express();
const isProduction = process.env.NODE_ENV === "production";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.set("trust proxy", 1);

const db = openDb();

const sessionStore = new PgSession({
  pool: db,
  createTableIfMissing: true
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction
    },
    store: sessionStore
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.use(authRoutes);
app.use(bookRoutes);
app.use(meRoutes);
app.use(summaryRoutes);

app.use((req, res) => {
  res.status(404).render("error", {
    title: "Not Found",
    message: "The page you are looking for does not exist."
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error", err);
  res.status(500).render("error", {
    title: "Server Error",
    message: "Something went wrong while handling your request."
  });
});

const port = process.env.PORT || 3000;
initDb(db)
  .then(() => {
    app.locals.db = db;
    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database", err);
    process.exit(1);
  });
