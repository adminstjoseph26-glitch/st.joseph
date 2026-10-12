-- Staff / admin sign-up requests. They cannot log in until an administrator approves them.
CREATE TABLE account_requests (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone      TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL CHECK (role IN ('admin','staff')),
  pass_hash  TEXT NOT NULL,
  created_at TEXT NOT NULL
);
