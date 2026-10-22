import { describe, expect, it } from "vitest";
import { checkPassword, checkTransfer, type User } from "@/lib/bank";

const u = (over: Partial<User> = {}): User => ({
  name: "A", email: "a@a.pt", salt: "s", pwHash: "h", balance: 5000, txs: [], logs: [],
  attempts: 0, lockedUntil: 0, ...over,
});

describe("rules", () => {
  it("rejects short passwords", () => expect(checkPassword("abc12")).not.toBeNull());
  it("rejects common passwords", () => expect(checkPassword("password123")).not.toBeNull());
  it("accepts strong password", () => expect(checkPassword("cavalo2026azul")).toBeNull());
  it("blocks transfer above 1000 €", () => expect(checkTransfer(u(), 1001)).not.toBeNull());
  it("blocks over 3000 € per day", () => {
    const txs = [{ id: "1", type: "out" as const, amount: 2500, label: "x", at: Date.now() }];
    expect(checkTransfer(u({ txs }), 600)).not.toBeNull();
    expect(checkTransfer(u({ txs }), 400)).toBeNull();
  });
});
