import { describe, expect, it } from "vitest";
import { parse, Pact } from "./pact";

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

    const { request, response } = parse(json).interactions[0];
    expect(request.headers!["Content-Type"]).toEqual("text/json");
    expect(request.headers!["Accept"]).toEqual(
      "text/plain,application/json,text/json",
    );
    expect(response.headers!["Content-Type"]).toEqual("application/json");
  });

  it("filters out non-HTTP interactions", () => {
    const request = {
      method: "GET",
      path: "/path",
    };
    const response = {
      status: 200,
    };
    const json = {
      interactions: [
        { description: "no-type", request, response },
        {
          type: "Synchronous/HTTP",
          description: "http",
          request,
          response,
        },
        {
          type: "Asynchronous/Messages",
          description: "async-message",
          request,
          response,
        },
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
    expect(pact.interactions[0].description).toBe("no-type");
    expect(pact.interactions[1].description).toBe("http");
    expect(pact.interactions[2]).toBeUndefined();
    expect(pact.interactions[3]).toBeUndefined();
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

    expect(pact.interactions[0].response.body).toEqual({ hello: "world" });
    expect(pact.interactions[1].response.body).toEqual({ hello: "world" });
    expect(pact.interactions[2].response.body).toEqual("hello world");
    expect(pact.interactions[3].request.body).toEqual({ hello: "world" });
    expect(pact.interactions[4].request.body).toEqual({ hello: "world" });
    expect(pact.interactions[5].request.body).toEqual("hello world");
    expect(pact.interactions[6].request.body).toEqual("{ not: json }");
    expect(pact.interactions[7].request.body).toEqual("abcdef");
  });
});
