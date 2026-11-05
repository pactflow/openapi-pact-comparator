---
"@pactflow/openapi-pact-comparator": minor
---

When the most specific route fails on a path parameter, compare the interaction
against another route that fits the URL and defines the method, in router
precedence. `/a/b` against `/a/{x}` with an integer `x` and `/{y}/b` now matches
`/{y}/b`. It previously failed with `request.path-or-method.unknown`.
