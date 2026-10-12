CREATE TABLE students (
  id             TEXT PRIMARY KEY,
  adm            TEXT NOT NULL UNIQUE,
  first          TEXT NOT NULL,
  middle         TEXT NOT NULL DEFAULT '',
  last           TEXT NOT NULL,
  gender         TEXT NOT NULL CHECK (gender IN ('Male','Female')),
  dob            TEXT NOT NULL,
  phone          TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  address        TEXT NOT NULL DEFAULT '',
  region         TEXT NOT NULL DEFAULT '',
  programme      TEXT NOT NULL,
  year           INTEGER NOT NULL DEFAULT 1,
  guardian       TEXT NOT NULL DEFAULT '',
  guardian_phone TEXT NOT NULL DEFAULT '',
  prev_school    TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Active','Suspended','Graduated')),
  registered     TEXT NOT NULL
);

CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash  TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin','student')),
  name       TEXT NOT NULL DEFAULT '',
  student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE grades (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course     TEXT NOT NULL,
  term       TEXT NOT NULL,
  score      REAL NOT NULL CHECK (score >= 0 AND score <= 100)
);
CREATE INDEX idx_grades_student ON grades(student_id);

CREATE TABLE books (
  id       TEXT PRIMARY KEY,
  title    TEXT NOT NULL,
  author   TEXT NOT NULL,
  category TEXT NOT NULL,
  call_no  TEXT NOT NULL DEFAULT '',
  copies   INTEGER NOT NULL DEFAULT 1 CHECK (copies >= 1)
);

CREATE TABLE loans (
  id         TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  issued     TEXT NOT NULL,
  due        TEXT NOT NULL,
  returned   TEXT
);
CREATE INDEX idx_loans_book ON loans(book_id);
CREATE INDEX idx_loans_student ON loans(student_id);

CREATE TABLE ebooks (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  author    TEXT NOT NULL,
  category  TEXT NOT NULL,
  format    TEXT NOT NULL DEFAULT 'PDF',
  added     TEXT NOT NULL,
  file_key  TEXT,
  file_name TEXT NOT NULL DEFAULT ''
);

CREATE TABLE messages (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  email   TEXT NOT NULL,
  phone   TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  date    TEXT NOT NULL
);

CREATE TABLE subscribers (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  date  TEXT NOT NULL
);

CREATE TABLE adm_counter (
  year INTEGER PRIMARY KEY,
  n    INTEGER NOT NULL
);

CREATE TABLE login_throttle (
  email    TEXT PRIMARY KEY,
  fails    INTEGER NOT NULL,
  first_at INTEGER NOT NULL
);
