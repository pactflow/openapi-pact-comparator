---
"@pactflow/openapi-pact-comparator": patch
---

Improve the error message if it encounters a malformed `comments.references.AsyncAPI` reference (e.g. a typo like `operation` instead of `operationId`) by explicitly stating what was expected.
