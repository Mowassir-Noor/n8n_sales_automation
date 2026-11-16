#!/usr/bin/env node
// Makes one DASH_USERS entry for email + password sign-in.
//   node scripts/hash-password.mjs you@example.com
// Type the password when asked (it is not shown). Paste the printed line into DASH_USERS
// in dashboard.env; several users are separated by commas. The password itself is never stored.
import { randomBytes, scryptSync } from "node:crypto";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email.includes("@")) {
  console.error("Usage: node scripts/hash-password.mjs <email>");
  process.exit(1);
}

function ask(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let value = "";
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

let pw, again;
if (process.stdin.isTTY) {
  pw = await ask("Password: ");
  again = await ask("Again: ");
} else {
  // Piped input: the password on the first line (used once, no repeat needed).
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  pw = again = data.split(/\r?\n/)[0];
}
if (pw.length < 10) {
  console.error("Use at least 10 characters.");
  process.exit(1);
}
if (again !== pw) {
  console.error("The two passwords differ.");
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
console.log(`${email}:${salt.toString("base64url")}:${hash.toString("base64url")}`);
