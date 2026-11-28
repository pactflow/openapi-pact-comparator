import { describe, expect, it } from "vitest";

import { nats } from "./nats";

describe("nats", () => {
  it.each([
    ["test.events", "test.events", "match"],
    ["test.events", "test.events.wrong", "mismatch"],
    [
      "{ring}.{stampKind}.{region}.{index}.tenant.domain.status",
      "r1.universal.eu-west-1.001.tenant.domain.status",
      "match",
    ],
    [
      "{ring}.{stampKind}.{region}.{index}.tenant.domain.status",
      "r1.universal.eu-west-1.tenant.domain.status",
      "mismatch",
    ],
    [
      "Workflow.{environmentKey}.{workflowKey}-{revision}",
      "Workflow.env1.wf-3",
      "match",
    ],
    [
      "Workflow.{environmentKey}.{workflowKey}-{revision}",
      "Workflow.env1.wf3",
      "mismatch",
    ],
    ["orders.{id}", "orders.a/b", "match"],
    [
      "*.*.*.tenantservice.GetCustomDomain.*.*",
      "platform.eu-west-1.01.tenantservice.GetCustomDomain.t1.e1",
      "match",
    ],
    [
      "*.*.*.tenantservice.GetCustomDomain.*.*",
      "platform.eu-west-1.01.tenantservice.GetCustomDomain.t1",
      "mismatch",
    ],
    [
      "{stampKind}.{region}.{index}.hibernation-operator.wake-environment.>",
      "id.eu-west-1.01.hibernation-operator.wake-environment.t1.e1",
      "match",
    ],
    [
      "{stampKind}.{region}.{index}.hibernation-operator.wake-environment.>",
      "id.eu-west-1.01.hibernation-operator.wake-environment",
      "mismatch",
    ],
    ["a.>.b", "a.x.b", "mismatch"],
    ["a.#", "a.x", "mismatch"],
    ["a.(b)+", "a.(b)+", "match"],
    ["a.(b)+", "a.bb", "mismatch"],
  ])("%s vs %s -> %s", (address, destination, status) => {
    expect(nats.check(destination, { address }).status).toBe(status);
  });

  it("reports the address it compared with", () => {
    expect(nats.check("a.c", { address: "a.b" })).toEqual({
      status: "mismatch",
      against: "the channel address",
      expected: "a.b",
      spec: { location: ".address", value: "a.b" },
    });
  });

  it.each([null, undefined])("skips a channel with address %s", (address) => {
    expect(nats.check("a.b", { address })).toEqual({ status: "skip" });
  });
});
