-- Catalogue details (like a Koha record)
ALTER TABLE books ADD COLUMN isbn        TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN publisher   TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN year        TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN description TEXT NOT NULL DEFAULT '';

-- Digital library items (like a DSpace record): abstract, publisher, year, type, review status, download counter
ALTER TABLE ebooks ADD COLUMN description  TEXT NOT NULL DEFAULT '';
ALTER TABLE ebooks ADD COLUMN publisher    TEXT NOT NULL DEFAULT '';
ALTER TABLE ebooks ADD COLUMN year         TEXT NOT NULL DEFAULT '';
ALTER TABLE ebooks ADD COLUMN item_type    TEXT NOT NULL DEFAULT 'Book';
ALTER TABLE ebooks ADD COLUMN status       TEXT NOT NULL DEFAULT 'Published';
ALTER TABLE ebooks ADD COLUMN submitted_by TEXT NOT NULL DEFAULT '';
ALTER TABLE ebooks ADD COLUMN downloads    INTEGER NOT NULL DEFAULT 0;

-- Loan renewals
ALTER TABLE loans ADD COLUMN renewals INTEGER NOT NULL DEFAULT 0;

-- Book reservations (holds) placed by students
CREATE TABLE reservations (
  id         TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Ready','Fulfilled','Cancelled'))
);
CREATE INDEX idx_res_book ON reservations(book_id);
CREATE INDEX idx_res_student ON reservations(student_id);
