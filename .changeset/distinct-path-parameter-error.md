---
"@pactflow/openapi-pact-comparator": minor
---

When a path fits a template, a parameter fails its schema and no other route
accepts the URL, report `request.path-parameter.incompatible`, naming the
parameter and the document's path. Previously it was reported as
`request.path-or-method.unknown`, which said the path was not defined. Anything
matching on that code string for this case needs updating. The interaction still
fails.
