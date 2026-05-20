import { describe, expect, it } from "vitest";
import { type Pact, parse } from "./pact";

describe("#parser", () => {
  it("flattens headers", () => {
    const json = {
      interactions: [
        {
          request: {
            method: "POST",
            path: "/stuff",
            headers: {
              Accept: ["text/plain", "application/json", "text/json"],
              "Content-Type": ["text/json"],
            },
          },
          response: {
            status: 201,
            headers: {
              "Content-Type": ["application/json"],
            },
            body: "body",
          },
        },
      ],
    } as Pact;

    const parsed = parse(json).interactions[0];
    if (parsed._kind !== "http") throw new Error("expected http interaction");
    expect(parsed.request.headers!["Content-Type"]).toEqual("text/json");
    expect(parsed.request.headers!["Accept"]).toEqual(
      "text/plain,application/json,text/json",
    );
    expect(parsed.response.headers!["Content-Type"]).toEqual(
      "application/json",
    );
  });

  it("maps interactions to _kind discriminants", () => {
    const request = { method: "GET", path: "/path" };
    const response = { status: 200 };
    const json = {
      interactions: [
        { description: "no-type", request, response },
        { type: "Synchronous/HTTP", description: "http", request, response },
        { type: "Asynchronous/Messages", description: "async-message" },
        {
          type: "Synchronous/Messages",
          description: "sync-message",
          request,
          response,
        },
      ],
    };

    const pact = parse(json as Pact);
    expect(pact.interactions.length).toBe(4);
    expect(pact.interactions[0]._kind).toBe("http");
    expect(pact.interactions[1]._kind).toBe("http");
    expect(pact.interactions[2]._kind).toBe("async");
    expect(pact.interactions[3]._kind).toBe("skip");
  });

  it("parses asyncapiReferences when present in comments", () => {
    const json = {
      interactions: [
        {
          type: "Asynchronous/Messages",
          description: "org-deleted",
          providerState: "an org exists",
          comments: {
            references: {
              AsyncAPI: {
                messageId: "organizationDeleted",
                operationId: "consumeFromEventsQueue",
              },
            },
          },
          contents: {
            content: { organizationId: "abc-123" },
            contentType: "application/json",
            encoded: false,
          },
          metadata: { "detail-type": "organization-deleted" },
        },
      ],
    };

    const pact = parse(json as Pact);
    const interaction = pact.interactions[0];
    if (interaction._kind !== "async")
      throw new Error("expected async interaction");
    expect(interaction.asyncapiReferences).toEqual({
      messageId: "organizationDeleted",
      operationId: "consumeFromEventsQueue",
    });
    expect(interaction.payload).toEqual({ organizationId: "abc-123" });
    expect(interaction.contentType).toBe("application/json");
    expect(interaction.metadata).toEqual({
      "detail-type": "organization-deleted",
    });
    expect(interaction.description).toBe("org-deleted");
    expect(interaction.providerState).toBe("an org exists");
  });

  it("does not crash and skips interactions with non-string type values", () => {
    const request = { method: "GET", path: "/path" };
    const response = { status: 200 };
    const json = {
      interactions: [
        { type: 123, description: "numeric-type", request, response },
        { type: true, description: "bool-type", request, response },
        { type: {}, description: "object-type", request, response },
      ],
    };

    expect(() => parse(json as Pact)).not.toThrow();
    const pact = parse(json as Pact);
    expect(pact.interactions).toHaveLength(3);
    pact.interactions.forEach((i) => expect(i._kind).toBe("skip"));
  });

  it("leaves asyncapiReferences undefined when comments.references.AsyncAPI is absent", () => {
    const json = {
      interactions: [
        {
          type: "Asynchronous/Messages",
          contents: {
            content: { foo: "bar" },
            contentType: "application/json",
            encoded: false,
          },
        },
        {
          type: "Asynchronous/Messages",
          comments: { references: {} },
          contents: {
            content: "plain",
            contentType: "text/plain",
            encoded: false,
          },
        },
      ],
    };

    const pact = parse(json as Pact);
    const first = pact.interactions[0];
    const second = pact.interactions[1];
    if (first._kind !== "async" || second._kind !== "async")
      throw new Error("expected async interactions");
    expect(first.asyncapiReferences).toBeUndefined();
    expect(second.asyncapiReferences).toBeUndefined();
  });

  it("should parse V4 body types", () => {
    const withRequestBody = (body: unknown) => ({
      request: {
        method: "POST",
        path: "/products",
        body,
      },
      response: {
        status: 200,
      },
    });
    const withResponseBody = (body: unknown) => ({
      request: {
        method: "POST",
        path: "/products",
      },
      response: {
        status: 200,
        body,
      },
    });

    const json = {
      interactions: [
        withResponseBody({
          encoded: false,
          content: { hello: "world" },
        }),
        withResponseBody({
          encoded: "JSON",
          content: '{ "hello": "world" }',
        }),
        withResponseBody({
          encoded: "base64",
          content: "aGVsbG8gd29ybGQ=",
        }),
        withRequestBody({
          encoded: false,
          content: { hello: "world" },
        }),
        withRequestBody({
          encoded: "JSON",
          content: '{ "hello": "world" }',
        }),
        withRequestBody({
          encoded: "base64",
          content: "aGVsbG8gd29ybGQ=",
        }),
        withRequestBody({
          encoded: "JSON",
          content: "{ not: json }",
        }),
        withRequestBody({
          encoded: "foo",
          content: "abcdef",
        }),
      ],
      metadata: {
        pactSpecification: {
          version: "4.0.0",
        },
      },
    };

    const pact = parse(json as Pact);

    const interactions = pact.interactions.map((i) => {
      if (i._kind !== "http") throw new Error("expected http interaction");
      return i;
    });

    expect(interactions[0].response.body).toEqual({ hello: "world" });
    expect(interactions[1].response.body).toEqual({ hello: "world" });
    expect(interactions[2].response.body).toEqual("hello world");
    expect(interactions[3].request.body).toEqual({ hello: "world" });
    expect(interactions[4].request.body).toEqual({ hello: "world" });
    expect(interactions[5].request.body).toEqual("hello world");
    expect(interactions[6].request.body).toEqual("{ not: json }");
    expect(interactions[7].request.body).toEqual("abcdef");
  });
});
