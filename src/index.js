/* St Joseph's College: Cloudflare Worker API
   Bindings: DB (D1 database), FILES (R2 bucket) */

const PROGRAMMES = ["DIE", "CIT", "DBA", "CLI", "CCD"];
const GENDERS = ["Male", "Female"];
const STATUSES = ["Pending", "Active", "Suspended", "Graduated"];
const TERMS = ["Semester 1", "Semester 2"];
const FILE_TYPES = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
};
const MAX_FILE = 20 * 1024 * 1024; // 20 MB
const PBKDF2_ITER = 100000; // Workers allow at most 100,000
const SESSION_MS = 7 * 24 * 3600 * 1000;
const COOKIE = "sjc_session";
const DUMMY_HASH = `pbkdf2$${PBKDF2_ITER}$${"0".repeat(32)}$${"0".repeat(64)}`;

/* ---------- small helpers ---------- */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = m => new HttpError(400, m);
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
const newId = () => crypto.randomUUID();
const enc = new TextEncoder();
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const fromHex = h => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
const sha256 = async s => toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fullName = s => [s.first, s.middle, s.last].filter(Boolean).join(" ");

/* ---------- validation ---------- */
function str(v, label, { max = 200, req = false } = {}) {
  v = String(v ?? "").trim();
  if (req && !v) throw bad(`${label} is required.`);
  if (v.length > max) throw bad(`${label} is too long.`);
  return v;
}
function oneOf(v, label, list) {
  v = String(v ?? "").trim();
  if (!list.includes(v)) throw bad(`${label} is not valid.`);
  return v;
}
function emailStr(v) {
  v = String(v ?? "").trim().toLowerCase();
  if (v.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad("Enter a valid email address.");
  return v;
}
function dateStr(v, label) {
  v = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw bad(`${label} is not a valid date.`);
  return v;
}
function intRange(v, label, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}
function passwordStr(v) {
  v = String(v ?? "");
  if (v.length < 8) throw bad("The password must have at least 8 characters.");
  if (v.length > 200) throw bad("The password is too long.");
  return v;
}
async function body(req) {
  try { const b = await req.json(); if (b && typeof b === "object") return b; } catch (e) {}
  throw bad("Invalid request.");
}

/* ---------- passwords (PBKDF2-SHA256) ---------- */
async function derive(pw, saltHex, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: iter }, key, 256);
  return toHex(bits);
}
async function hashPassword(pw) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2$${PBKDF2_ITER}$${salt}$${await derive(pw, salt, PBKDF2_ITER)}`;
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function verifyPassword(pw, stored) {
  const [alg, iter, salt, hash] = String(stored).split("$");
  if (alg !== "pbkdf2" || !salt || !hash) return false;
  const calc = await derive(pw, salt, Math.min(Number(iter) || PBKDF2_ITER, PBKDF2_ITER));
  return safeEqual(calc, hash);
}

/* ---------- sessions ---------- */
const sessionCookie = (token, expires, secure) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure ? "; Secure" : ""}`;
const tokenFrom = req => (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`))?.[1] || null;

async function createSession(env, userId) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const exp = Date.now() + SESSION_MS;
  await env.DB.prepare("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?,?,?)").bind(await sha256(token), userId, exp).run();
  return { token, exp };
}
async function currentUser(req, env) {
  const token = tokenFrom(req);
  if (!token) return null;
  return (await env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.name, u.student_id AS studentId
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(await sha256(token), Date.now()).first()) || null;
}

/* ---------- SQL snippets (column aliases match what index.html expects) ---------- */
const STUDENTS = `SELECT id, adm, first, middle, last, gender, dob, phone, email, address, region, programme, year,
  guardian, guardian_phone AS guardianPhone, prev_school AS prevSchool, status, registered FROM students`;
const GRADES = `SELECT id, student_id AS studentId, course, term, score FROM grades`;
const LOANS = `SELECT id, book_id AS bookId, student_id AS studentId, issued, due, returned FROM loans`;
const BOOKS = `SELECT b.id, b.title, b.author, b.category, b.copies, b.call_no AS "call",
  (SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id AND l.returned IS NULL) AS "out"
  FROM books b ORDER BY b.title COLLATE NOCASE`;
const EBOOKS = `SELECT id, title, author, category, format, added, (file_key IS NOT NULL) AS hasFile, file_name AS fileName
  FROM ebooks ORDER BY added DESC, title COLLATE NOCASE`;

const INSERT_STUDENT = `INSERT INTO students(id, adm, first, middle, last, gender, dob, phone, email, address, region,
  programme, year, guardian, guardian_phone, prev_school, status, registered) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

async function nextAdm(env) {
  const y = Number(today().slice(0, 4));
  const r = await env.DB.prepare(
    "INSERT INTO adm_counter(year, n) VALUES(?, 1) ON CONFLICT(year) DO UPDATE SET n = n + 1 RETURNING n"
  ).bind(y).first();
  return `SJC/${y}/${String(r.n).padStart(4, "0")}`;
}
async function assertEmailFree(env, email, exceptStudentId = null) {
  const a = await env.DB.prepare("SELECT 1 AS x FROM students WHERE email = ? AND id IS NOT ?").bind(email, exceptStudentId).first();
  const b = await env.DB.prepare("SELECT 1 AS x FROM users WHERE email = ? AND student_id IS NOT ?").bind(email, exceptStudentId).first();
  if (a || b) throw new HttpError(409, "An account with this email already exists.");
}
function readStudent(b, admin) {
  const s = {
    first: str(b.first, "First name", { req: true, max: 60 }),
    middle: str(b.middle, "Middle name", { max: 60 }),
    last: str(b.last, "Last name", { req: true, max: 60 }),
    gender: oneOf(b.gender, "Gender", GENDERS),
    dob: dateStr(b.dob, "Date of birth"),
    phone: str(b.phone, "Phone number", { req: true, max: 30 }),
    email: emailStr(b.email),
    address: str(b.address, "Postal address", { max: 200 }),
    region: str(b.region, "Region", { max: 60 }),
    programme: oneOf(b.programme, "Programme", PROGRAMMES),
    year: intRange(b.year ?? 1, "Year of study", 1, 4),
    guardian: str(b.guardian, "Guardian name", { max: 100 }),
    guardianPhone: str(b.guardianPhone, "Guardian phone", { max: 30 }),
    prevSchool: str(b.prevSchool, "Previous school", { max: 150 }),
  };
  if (s.dob > today()) throw bad("Date of birth cannot be in the future.");
  if (admin) s.status = oneOf(b.status || "Active", "Status", STATUSES);
  return s;
}
const studentBinds = (id, adm, s, status, registered) => [
  id, adm, s.first, s.middle, s.last, s.gender, s.dob, s.phone, s.email, s.address, s.region,
  s.programme, s.year, s.guardian, s.guardianPhone, s.prevSchool, status, registered,
];

/* ---------- router ---------- */
const routes = [];
const route = (method, path, auth, handler) =>
  routes.push({ method, auth, handler, re: new RegExp("^" + path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$") });

/* ===== public ===== */
route("GET", "/api/bootstrap", "public", async ({ env, user }) => {
  const db = env.DB;
  const q = {
    books: db.prepare(BOOKS),
    ebooks: db.prepare(EBOOKS),
    count: db.prepare("SELECT COUNT(*) AS n FROM students WHERE status = 'Active'"),
  };
  if (user?.role === "admin") {
    q.students = db.prepare(STUDENTS + " ORDER BY rowid");
    q.grades = db.prepare(GRADES + " ORDER BY rowid");
    q.loans = db.prepare(LOANS + " ORDER BY rowid");
    q.messages = db.prepare("SELECT id, name, email, phone, subject, message, date FROM messages ORDER BY rowid");
    q.subscribers = db.prepare("SELECT email, date FROM subscribers ORDER BY rowid");
  } else if (user?.studentId) {
    q.students = db.prepare(STUDENTS + " WHERE id = ?").bind(user.studentId);
    q.grades = db.prepare(GRADES + " WHERE student_id = ? ORDER BY rowid").bind(user.studentId);
    q.loans = db.prepare(LOANS + " WHERE student_id = ? ORDER BY rowid").bind(user.studentId);
  }
  const keys = Object.keys(q);
  const res = await db.batch(keys.map(k => q[k]));
  const r = Object.fromEntries(keys.map((k, i) => [k, res[i].results]));
  return json({
    me: user,
    stats: { students: r.count[0].n },
    books: r.books,
    ebooks: r.ebooks,
    students: r.students || [],
    grades: r.grades || [],
    loans: r.loans || [],
    messages: r.messages || [],
    subscribers: r.subscribers || [],
  });
});

route("POST", "/api/login", "public", async ({ req, env, url }) => {
  const b = await body(req);
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  const pw = String(b.password ?? "").slice(0, 200);
  const now = Date.now();

  const th = await env.DB.prepare("SELECT fails, first_at FROM login_throttle WHERE email = ?").bind(email).first();
  if (th && th.fails >= 5 && now - th.first_at < 15 * 60 * 1000)
    throw new HttpError(429, "Too many failed attempts. Please try again in 15 minutes.");

  const u = await env.DB.prepare("SELECT id, pass_hash FROM users WHERE email = ?").bind(email).first();
  const ok = await verifyPassword(pw, u ? u.pass_hash : DUMMY_HASH); // same work whether or not the user exists
  if (!u || !ok) {
    await env.DB.prepare(
      `INSERT INTO login_throttle(email, fails, first_at) VALUES(?1, 1, ?2)
       ON CONFLICT(email) DO UPDATE SET
         fails    = CASE WHEN ?2 - first_at > 900000 THEN 1 ELSE fails + 1 END,
         first_at = CASE WHEN ?2 - first_at > 900000 THEN ?2 ELSE first_at END`
    ).bind(email, now).run();
    throw new HttpError(401, "The email or password is not correct. Check both and try again.");
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_throttle WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
  ]);
  const { token, exp } = await createSession(env, u.id);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, exp, url.protocol === "https:") });
});

route("POST", "/api/logout", "public", async ({ req, env, url }) => {
  const token = tokenFrom(req);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0, url.protocol === "https:") });
});

route("POST", "/api/register", "public", async ({ req, env }) => {
  const b = await body(req);
  const s = readStudent(b, false);
  const pw = passwordStr(b.password);
  if (b.password !== b.password2) throw bad("The two passwords do not match.");
  await assertEmailFree(env, s.email);
  const adm = await nextAdm(env);
  const sid = newId();
  const hash = await hashPassword(pw);
  await env.DB.batch([
    env.DB.prepare(INSERT_STUDENT).bind(...studentBinds(sid, adm, s, "Pending", today())),
    env.DB.prepare("INSERT INTO users(id, email, pass_hash, role, name, student_id, created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(newId(), s.email, hash, "student", fullName(s), sid, Date.now()),
  ]);
  return json({ adm, first: s.first }, 201);
});

route("POST", "/api/contact", "public", async ({ req, env }) => {
  const b = await body(req);
  await env.DB.prepare("INSERT INTO messages(id, name, email, phone, subject, message, date) VALUES(?,?,?,?,?,?,?)").bind(
    newId(),
    str(b.name, "Name", { req: true, max: 100 }),
    emailStr(b.email),
    str(b.phone, "Phone number", { max: 30 }),
    str(b.subject, "Subject", { req: true, max: 200 }),
    str(b.message, "Message", { req: true, max: 5000 }),
    today()
  ).run();
  return json({ ok: true }, 201);
});

route("POST", "/api/subscribe", "public", async ({ req, env }) => {
  const b = await body(req);
  await env.DB.prepare("INSERT OR IGNORE INTO subscribers(email, date) VALUES(?,?)").bind(emailStr(b.email), today()).run();
  return json({ ok: true }, 201);
});

/* ===== any signed-in user ===== */
route("POST", "/api/password", "user", async ({ req, env, user, url }) => {
  const b = await body(req);
  const row = await env.DB.prepare("SELECT pass_hash FROM users WHERE id = ?").bind(user.id).first();
  if (!(await verifyPassword(String(b.old ?? ""), row.pass_hash))) throw bad("The current password is not correct.");
  const pw = passwordStr(b.pw);
  if (b.pw !== b.pw2) throw bad("The new passwords do not match.");
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").bind(await hashPassword(pw), user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id), // sign out everywhere else
  ]);
  const { token, exp } = await createSession(env, user.id);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, exp, url.protocol === "https:") });
});

route("GET", "/api/ebooks/:id/file", "user", async ({ env, params }) => {
  const row = await env.DB.prepare("SELECT file_key, file_name FROM ebooks WHERE id = ?").bind(params.id).first();
  if (!row || !row.file_key) throw new HttpError(404, "File not found.");
  const obj = await env.FILES.get(row.file_key);
  if (!obj) throw new HttpError(404, "File not found.");
  const ext = row.file_key.split(".").pop();
  const ascii = row.file_name.replace(/[^\w.\- ]+/g, "_") || "download";
  return new Response(obj.body, {
    headers: {
      "content-type": FILE_TYPES[ext] || "application/octet-stream",
      "content-length": String(obj.size),
      "content-disposition": `${ext === "pdf" ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});

/* ===== admin: students ===== */
route("POST", "/api/students", "admin", async ({ req, env }) => {
  const s = readStudent(await body(req), true);
  await assertEmailFree(env, s.email);
  await env.DB.prepare(INSERT_STUDENT).bind(...studentBinds(newId(), await nextAdm(env), s, s.status, today())).run();
  return json({ ok: true }, 201);
});
route("PUT", "/api/students/:id", "admin", async ({ req, env, params }) => {
  if (!(await env.DB.prepare("SELECT 1 AS x FROM students WHERE id = ?").bind(params.id).first())) throw new HttpError(404, "Student not found.");
  const s = readStudent(await body(req), true);
  await assertEmailFree(env, s.email, params.id);
  await env.DB.batch([
    env.DB.prepare(`UPDATE students SET first=?, middle=?, last=?, gender=?, dob=?, phone=?, email=?, address=?, region=?,
      programme=?, year=?, guardian=?, guardian_phone=?, prev_school=?, status=? WHERE id=?`).bind(
      s.first, s.middle, s.last, s.gender, s.dob, s.phone, s.email, s.address, s.region,
      s.programme, s.year, s.guardian, s.guardianPhone, s.prevSchool, s.status, params.id),
    env.DB.prepare("UPDATE users SET name = ?, email = ? WHERE student_id = ?").bind(fullName(s), s.email, params.id),
  ]);
  return json({ ok: true });
});
route("POST", "/api/students/:id/approve", "admin", async ({ env, params }) => {
  const r = await env.DB.prepare("UPDATE students SET status = 'Active' WHERE id = ?").bind(params.id).run();
  if (!r.meta.changes) throw new HttpError(404, "Student not found.");
  return json({ ok: true });
});
route("DELETE", "/api/students/:id", "admin", async ({ env, params }) => {
  // grades, loans, the login and its sessions are removed by ON DELETE CASCADE
  const r = await env.DB.prepare("DELETE FROM students WHERE id = ?").bind(params.id).run();
  if (!r.meta.changes) throw new HttpError(404, "Student not found.");
  return json({ ok: true });
});

/* ===== admin: grades ===== */
function readGrade(b) {
  const score = Number(b.score);
  if (b.score === "" || b.score == null || !Number.isFinite(score) || score < 0 || score > 100) throw bad("Score must be from 0 to 100.");
  return {
    studentId: str(b.studentId, "Student", { req: true, max: 60 }),
    course: str(b.course, "Course", { req: true, max: 120 }),
    term: oneOf(b.term || "Semester 1", "Term", TERMS),
    score,
  };
}
route("POST", "/api/grades", "admin", async ({ req, env }) => {
  const g = readGrade(await body(req));
  await env.DB.prepare("INSERT INTO grades(id, student_id, course, term, score) VALUES(?,?,?,?,?)").bind(newId(), g.studentId, g.course, g.term, g.score).run();
  return json({ ok: true }, 201);
});
route("PUT", "/api/grades/:id", "admin", async ({ req, env, params }) => {
  const g = readGrade(await body(req));
  const r = await env.DB.prepare("UPDATE grades SET student_id=?, course=?, term=?, score=? WHERE id=?").bind(g.studentId, g.course, g.term, g.score, params.id).run();
  if (!r.meta.changes) throw new HttpError(404, "Result not found.");
  return json({ ok: true });
});
route("DELETE", "/api/grades/:id", "admin", async ({ env, params }) => {
  await env.DB.prepare("DELETE FROM grades WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
});

/* ===== admin: books ===== */
function readBook(b) {
  return {
    title: str(b.title, "Title", { req: true, max: 200 }),
    author: str(b.author, "Author", { req: true, max: 150 }),
    category: str(b.category, "Subject", { req: true, max: 80 }),
    call: str(b.call, "Call number", { max: 40 }),
    copies: intRange(b.copies, "Copies", 1, 1000),
  };
}
route("POST", "/api/books", "admin", async ({ req, env }) => {
  const b = readBook(await body(req));
  let call = b.call;
  if (!call) {
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM books").first()).n;
    call = b.category.slice(0, 3).toUpperCase() + "." + String(n + 100).padStart(3, "0");
  }
  await env.DB.prepare("INSERT INTO books(id, title, author, category, call_no, copies) VALUES(?,?,?,?,?,?)").bind(newId(), b.title, b.author, b.category, call, b.copies).run();
  return json({ ok: true }, 201);
});
route("PUT", "/api/books/:id", "admin", async ({ req, env, params }) => {
  const b = readBook(await body(req));
  const r = await env.DB.prepare("UPDATE books SET title=?, author=?, category=?, call_no=?, copies=? WHERE id=?").bind(b.title, b.author, b.category, b.call, b.copies, params.id).run();
  if (!r.meta.changes) throw new HttpError(404, "Book not found.");
  return json({ ok: true });
});
route("DELETE", "/api/books/:id", "admin", async ({ env, params }) => {
  await env.DB.prepare("DELETE FROM books WHERE id = ?").bind(params.id).run(); // loans cascade
  return json({ ok: true });
});

/* ===== admin: loans ===== */
route("POST", "/api/loans", "admin", async ({ req, env }) => {
  const b = await body(req);
  const bookId = str(b.bookId, "Book", { req: true, max: 60 });
  const studentId = str(b.studentId, "Student", { req: true, max: 60 });
  const issued = dateStr(b.issued, "Issue date");
  const days = intRange(b.days || 14, "Loan period", 1, 60);
  // one statement: only inserts if a copy is free and the student is active (safe against double-clicks)
  const r = await env.DB.prepare(
    `INSERT INTO loans(id, book_id, student_id, issued, due, returned)
     SELECT ?1, ?2, ?3, ?4, ?5, NULL
      WHERE (SELECT copies FROM books WHERE id = ?2) > (SELECT COUNT(*) FROM loans WHERE book_id = ?2 AND returned IS NULL)
        AND EXISTS (SELECT 1 FROM students WHERE id = ?3 AND status = 'Active')`
  ).bind(newId(), bookId, studentId, issued, addDays(issued, days)).run();
  if (!r.meta.changes) throw new HttpError(409, "No copy is available, or the student is not active.");
  return json({ ok: true }, 201);
});
route("POST", "/api/loans/:id/return", "admin", async ({ env, params }) => {
  const r = await env.DB.prepare("UPDATE loans SET returned = ? WHERE id = ? AND returned IS NULL").bind(today(), params.id).run();
  if (!r.meta.changes) throw new HttpError(409, "This loan is already returned or does not exist.");
  return json({ ok: true });
});

/* ===== admin: e-library (files live in R2) ===== */
async function readEbookForm(req) {
  let fd;
  try { fd = await req.formData(); } catch (e) { throw bad("Invalid upload."); }
  const rec = {
    title: str(fd.get("title"), "Title", { req: true, max: 200 }),
    author: str(fd.get("author"), "Author", { req: true, max: 150 }),
    category: str(fd.get("category"), "Category", { req: true, max: 80 }),
    format: oneOf(fd.get("format") || "PDF", "Format", ["PDF", "EPUB", "DOCX", "Other"]),
  };
  const f = fd.get("file");
  let upload = null;
  if (f instanceof File && f.size > 0) {
    if (f.size > MAX_FILE) throw bad("The file is larger than 20 MB.");
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!FILE_TYPES[ext]) throw bad("Only PDF, EPUB, DOC, DOCX and TXT files are allowed.");
    upload = { ext, name: f.name.slice(0, 200), data: await f.arrayBuffer() };
  }
  return { rec, upload };
}
const putFile = async (env, id, u) => {
  const key = `ebooks/${id}/${crypto.randomUUID()}.${u.ext}`;
  await env.FILES.put(key, u.data, { httpMetadata: { contentType: FILE_TYPES[u.ext] }, customMetadata: { originalName: u.name } });
  return key;
};

route("POST", "/api/ebooks", "admin", async ({ req, env }) => {
  const { rec, upload } = await readEbookForm(req);
  const id = newId();
  const key = upload ? await putFile(env, id, upload) : null;
  try {
    await env.DB.prepare("INSERT INTO ebooks(id, title, author, category, format, added, file_key, file_name) VALUES(?,?,?,?,?,?,?,?)")
      .bind(id, rec.title, rec.author, rec.category, rec.format, today(), key, upload ? upload.name : "").run();
  } catch (e) {
    if (key) await env.FILES.delete(key);
    throw e;
  }
  return json({ ok: true }, 201);
});
route("PUT", "/api/ebooks/:id", "admin", async ({ req, env, params }) => {
  const cur = await env.DB.prepare("SELECT file_key, file_name FROM ebooks WHERE id = ?").bind(params.id).first();
  if (!cur) throw new HttpError(404, "Resource not found.");
  const { rec, upload } = await readEbookForm(req);
  const key = upload ? await putFile(env, params.id, upload) : cur.file_key;
  const name = upload ? upload.name : cur.file_name;
  try {
    await env.DB.prepare("UPDATE ebooks SET title=?, author=?, category=?, format=?, file_key=?, file_name=? WHERE id=?")
      .bind(rec.title, rec.author, rec.category, rec.format, key, name, params.id).run();
  } catch (e) {
    if (upload) await env.FILES.delete(key);
    throw e;
  }
  if (upload && cur.file_key) await env.FILES.delete(cur.file_key);
  return json({ ok: true });
});
route("DELETE", "/api/ebooks/:id", "admin", async ({ env, params }) => {
  const cur = await env.DB.prepare("SELECT file_key FROM ebooks WHERE id = ?").bind(params.id).first();
  if (!cur) return json({ ok: true });
  await env.DB.prepare("DELETE FROM ebooks WHERE id = ?").bind(params.id).run();
  if (cur.file_key) await env.FILES.delete(cur.file_key);
  return json({ ok: true });
});

/* ---------- entry point ---------- */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        if (origin && new URL(origin).host !== url.host) throw new HttpError(403, "Cross-origin request blocked.");
      }
      const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, "Not found.");
      const params = url.pathname.match(r.re).groups || {};
      const user = await currentUser(req, env);
      if (r.auth !== "public" && !user) throw new HttpError(401, "Please sign in.");
      if (r.auth === "admin" && user.role !== "admin") throw new HttpError(403, "Administrators only.");
      return await r.handler({ req, env, url, user, params });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      const m = String((e && e.message) || "");
      if (m.includes("UNIQUE constraint failed")) return json({ error: "This record already exists." }, 409);
      if (m.includes("FOREIGN KEY constraint failed")) return json({ error: "A related record was not found." }, 400);
      console.error(e);
      return json({ error: "Server error. Please try again." }, 500);
    }
  },
};
