-- Adds the 'staff' role. SQLite cannot change a CHECK constraint, so the users table is rebuilt.
-- Existing accounts are kept; everyone is signed out once (sessions are cleared).
DELETE FROM sessions;

CREATE TABLE users_new (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash  TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin','staff','student')),
  name       TEXT NOT NULL DEFAULT '',
  student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
INSERT INTO users_new SELECT id, email, pass_hash, role, name, student_id, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
