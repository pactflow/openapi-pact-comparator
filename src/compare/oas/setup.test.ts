import Router from "find-my-way";
import type { OpenAPIV3 } from "openapi-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Config, type ConfigKeys, DEFAULT_CONFIG } from "#utils/config";

import { findOtherRoutes, setupRouter } from "./setup";

vi.mock("find-my-way", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof Router }>();
  return { default: Object.assign(vi.fn(actual.default), actual.default) };
});

const document = (...paths: string[]) =>
  ({
    openapi: "3.0.0",
    info: { title: "test", version: "1.0.0" },
    paths: Object.fromEntries(
      paths.map((path) => [path, { get: { responses: {} } }]),
    ),
  }) as unknown as OpenAPIV3.Document;

const configWith = (...enabled: ConfigKeys[]): Config => {
  const config = new Map(DEFAULT_CONFIG);
  for (const key of enabled) {
    config.set(key, true);
  }
  return config;
};

const otherPaths = (
  router: ReturnType<typeof setupRouter>,
  url: string,
  excluded: object = {},
) =>
  Array.from(
    findOtherRoutes(
      router,
      "GET",
      url,
      excluded as Parameters<typeof findOtherRoutes>[3],
    ),
  ).map((route) => route.store.path);

describe("findOtherRoutes", () => {
  beforeEach(() => {
    vi.mocked(Router).mockClear();
  });

  it("builds no router for a route with a different literal prefix", () => {
    const router = setupRouter(
      document("/a/{id}", "/b/{id}", "/c/{id}/d"),
      configWith(),
    );
    expect(Router).toHaveBeenCalledTimes(1);

    expect(otherPaths(router, "/z/1")).toEqual([]);

    expect(Router).toHaveBeenCalledTimes(1);
  });

  it("applies the check when only the query is percent-encoded", () => {
    const router = setupRouter(document("/a/{id}"), configWith());
    vi.mocked(Router).mockClear();

    expect(otherPaths(router, "/z/1?q=%20")).toEqual([]);

    expect(Router).not.toHaveBeenCalled();
  });

  it.each<[string, ConfigKeys[], string, string]>([
    ["no normalisation", [], "/a/{id}", "/a/1"],
    ["a parameter at the start", [], "/{id}/b", "/a/b"],
    ["a literal colon", [], "/a:b/{id}", "/a:b/1"],
    ["a percent-encoded URL", [], "/é/{id}", "/%C3%A9/1"],
    ["a different case", ["case-insensitive"], "/A/{id}", "/a/1"],
    [
      "a duplicate slash in the URL",
      ["ignore-duplicate-slashes"],
      "/a/b/{id}",
      "/a//b/1",
    ],
    [
      "a duplicate slash in the route",
      ["ignore-duplicate-slashes"],
      "/a//b/{id}",
      "/a/b/1",
    ],
    ["a trailing slash in the route", ["ignore-trailing-slash"], "/a/", "/a"],
    ["a trailing slash in the URL", ["ignore-trailing-slash"], "/a", "/a/"],
  ])("finds a route with %s", (_name, enabled, path, url) => {
    const router = setupRouter(document(path), configWith(...enabled));

    expect(otherPaths(router, url)).toEqual([path]);
  });

  it("leaves out the excluded route", () => {
    const router = setupRouter(document("/a/{id}", "/a/{id}/b"), configWith());
    const route = router.find("GET", "/a/1")!;

    expect(otherPaths(router, "/a/1", route.store)).toEqual([]);
  });
});
