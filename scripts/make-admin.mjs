// Usage:  node scripts/make-admin.mjs
// Creates admin.sql with one administrator account (password is hashed, never stored in plain text).
// Then run:  npx wrangler d1 execute sjc-db --remote --file=admin.sql   (and delete admin.sql afterwards)
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { writeFileSync } from "node:fs";

// Interactive by default. For automation you can set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD instead.
let email = process.env.ADMIN_EMAIL, name = process.env.ADMIN_NAME, pw = process.env.ADMIN_PASSWORD;
if (!email || !pw) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  email = await rl.question("Admin email: ");
  name = await rl.question("Admin name [College Administrator]: ");
  pw = await rl.question("Password (at least 12 characters): ");
  rl.close();
}
email = email.trim().toLowerCase();
name = (name || "").trim() || "College Administrator";

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("Invalid email."); process.exit(1); }
if (pw.length < 12) { console.error("Password must have at least 12 characters."); process.exit(1); }

const ITER = 100000; // must match src/index.js
const salt = randomBytes(16);
const hash = pbkdf2Sync(pw, salt, ITER, 32, "sha256").toString("hex");
const q = s => "'" + s.replace(/'/g, "''") + "'";
const sql = `INSERT INTO users(id, email, pass_hash, role, name, created_at) VALUES(${q(randomUUID())}, ${q(email)}, ${q(`pbkdf2$${ITER}$${salt.toString("hex")}$${hash}`)}, 'admin', ${q(name)}, ${Date.now()});\n`;
writeFileSync("admin.sql", sql);
console.log("\nWrote admin.sql. Now run:\n  npx wrangler d1 execute sjc-db --remote --file=admin.sql\nThen delete admin.sql.");
