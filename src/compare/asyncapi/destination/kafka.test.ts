import { describe, expect, it } from "vitest";

import { kafka } from "./kafka";

describe("kafka", () => {
  it.each([
    ["orders.created", "orders.created", "match"],
    ["orders.created", "orders.updated", "mismatch"],
    ["orders.{region}.created", "orders.eu-west-1.created", "match"],
    ["orders.{region}.created", "orders.eu.west.created", "mismatch"],
  ])("%s vs %s -> %s", (address, destination, status) => {
    expect(kafka.check(destination, { address }).status).toBe(status);
  });

  it("compares with the binding topic when it is set", () => {
    const channel = {
      address: "orderEvents",
      bindings: { kafka: { topic: "orders.created" } },
    };
    expect(kafka.check("orders.created", channel)).toEqual({
      status: "match",
    });
    expect(kafka.check("orderEvents", channel)).toEqual({
      status: "mismatch",
      against: "the Kafka topic",
      expected: "orders.created",
      spec: { location: ".bindings.kafka.topic", value: "orders.created" },
    });
  });

  it("skips a channel with no address or topic", () => {
    expect(kafka.check("a", { address: null })).toEqual({ status: "skip" });
  });
});
