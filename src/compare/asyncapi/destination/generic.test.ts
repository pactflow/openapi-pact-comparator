import { describe, expect, it } from "vitest";

import { generic } from "./generic";

describe("generic", () => {
  it.each([
    ["user/signup", "user/signup", "match"],
    ["users/{userId}/signup", "users/42/signup", "match"],
    ["users/{userId}/signup", "users/4/2/signup", "mismatch"],
    ["users.{userId}", "users.4.2", "mismatch"],
    ["users.{userId}", "users.42", "match"],
    ["sensors/+/temperature", "sensors/a/temperature", "unvalidatable"],
    ["orders.*", "orders.created", "unvalidatable"],
  ])("%s vs %s -> %s", (address, destination, status) => {
    expect(generic.check(destination, { address }).status).toBe(status);
  });

  it("skips a channel without an address", () => {
    expect(generic.check("a", {})).toEqual({ status: "skip" });
  });
});
