import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { clearFailures, isLocked, parseDashUsers, recordFailure, verifyPassword } from "./passwords";

function entry(email: string, pw: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `${email}:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

describe("passwords", () => {
  it("parses entries and verifies the right password only", () => {
    const users = parseDashUsers(`${entry("Admin@Example.com", "correct horse")}, ${entry("nil@example.com", "another one")},broken`);
    expect([...users.keys()]).toEqual(["admin@example.com", "nil@example.com"]);
    expect(verifyPassword("correct horse", users.get("admin@example.com")!)).toBe(true);
    expect(verifyPassword("wrong", users.get("admin@example.com")!)).toBe(false);
    expect(verifyPassword("correct horse", users.get("nil@example.com")!)).toBe(false);
  });

  it("locks an email after 8 failures and clears on success", () => {
    const e = "lock@example.com";
    for (let i = 0; i < 7; i++) recordFailure(e, 1000);
    expect(isLocked(e, 1000)).toBe(false);
    recordFailure(e, 1000);
    expect(isLocked(e, 2000)).toBe(true);
    expect(isLocked(e, 1000 + 16 * 60 * 1000)).toBe(false);
    recordFailure(e, 5000);
    clearFailures(e);
    expect(isLocked(e, 5000)).toBe(false);
  });
});
