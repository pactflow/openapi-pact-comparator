import { describe, expect, it } from "vitest";

import { amqp, parseRabbitMqAddress } from "./amqp";

describe("parseRabbitMqAddress", () => {
  it.each([
    ["/queues/my-queue", { queue: "my-queue" }],
    ["/exchanges/events", { exchange: "events" }],
    [
      "/exchanges/events/audit.events.users",
      { exchange: "events", routingKey: "audit.events.users" },
    ],
    [
      "/exchanges/amq.direct/my-routing_key%2F123",
      { exchange: "amq.direct", routingKey: "my-routing_key/123" },
    ],
    ["/exchanges/events/", { exchange: "events", routingKey: "" }],
    ["audit.events.users", undefined],
    ["/queues/", undefined],
    ["/queues/a/b", undefined],
    ["/exchange/events/key", undefined],
    ["/exchanges/%E0%A4%A", undefined],
  ])("%s", (value, expected) => {
    expect(parseRabbitMqAddress(value)).toEqual(expected);
  });
});

const topicChannel = (address: string) => ({
  address,
  bindings: {
    amqp: { is: "routingKey", exchange: { name: "events", type: "topic" } },
  },
});

describe("amqp", () => {
  it.each([
    ["regions.na.cities.*", "regions.na.cities.toronto", "match"],
    ["regions.na.cities.*", "regions.na.cities", "mismatch"],
    ["regions.na.cities.*", "regions.na.cities.a.b", "mismatch"],
    ["audit.events.#", "audit.events", "match"],
    ["audit.events.#", "audit.events.users.signup", "match"],
    ["audit.events.#", "audit.users", "mismatch"],
    ["#", "anything.at.all", "match"],
    ["a.#.z", "a.z", "match"],
    ["a.#.z", "a.b.c.z", "match"],
    ["user.*", "user/signup", "mismatch"],
    ["orders.{id}", "orders.42", "match"],
    ["a.>", "a.x", "mismatch"],
  ])("topic exchange: %s vs %s -> %s", (address, routingKey, status) => {
    const destination = `/exchanges/events/${encodeURIComponent(routingKey)}`;
    expect(amqp.check(destination, topicChannel(address)).status).toBe(status);
  });

  it.each([
    ["orders.*", "orders.*", "match"],
    ["orders.*", "orders.created", "mismatch"],
    ["orders.{id}", "orders.42", "match"],
  ])("direct exchange: %s vs %s -> %s", (address, routingKey, status) => {
    const channel = {
      address,
      bindings: { amqp: { exchange: { name: "orders", type: "direct" } } },
    };
    expect(amqp.check(`/exchanges/orders/${routingKey}`, channel).status).toBe(
      status,
    );
  });

  it("compares the exchange name", () => {
    expect(amqp.check("/exchanges/other/a.b", topicChannel("a.b"))).toEqual({
      status: "mismatch",
      against: "the AMQP exchange name",
      expected: "events",
      spec: { location: ".bindings.amqp.exchange.name", value: "events" },
    });
    expect(amqp.check("/exchanges/events", topicChannel("a.b"))).toEqual({
      status: "match",
    });
  });

  it("compares the queue name", () => {
    const channel = {
      address: "ignored",
      bindings: { amqp: { is: "queue", queue: { name: "my-queue" } } },
    };
    expect(amqp.check("/queues/my-queue", channel)).toEqual({
      status: "match",
    });
    expect(amqp.check("/queues/other", channel)).toMatchObject({
      status: "mismatch",
      against: "the AMQP queue name",
      expected: "my-queue",
    });
  });

  it.each([
    ["audit.events.users", topicChannel("audit.#")],
    ["/queues/my-queue", topicChannel("audit.#")],
    ["/exchanges/events/a.b", { address: "a.b" }],
    [
      "/exchanges/events/a.b",
      { address: null, bindings: topicChannel("x").bindings },
    ],
  ])("cannot compare %s with %j", (destination, channel) => {
    expect(amqp.check(destination, channel).status).toBe("unvalidatable");
  });
});
