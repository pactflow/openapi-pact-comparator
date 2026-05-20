---
"@pactflow/openapi-pact-comparator": major
---

Add AsyncAPI 3.x support for bidirectional contract testing

## Breaking Changes

- **`Comparator` constructor** — previously accepted a single positional OAS document argument (`new Comparator(oas)`); now accepts an options object (`new Comparator({ oas?, asyncapi? })`). At least one of `oas` or `asyncapi` must be provided.

- **CLI** — the OAS file path was previously a required positional argument (`opc <oas> <pact...>`); it is now a named option (`opc --oas <path> <pact...>`). Use `--asyncapi <path>` instead of or alongside `--oas` to pass an AsyncAPI document.

## New Features

- AsyncAPI 3.x spec validation for async message interactions in Pact v4 files
- Validates message payload and headers against the schemas defined in the AsyncAPI spec, with full `$ref` resolution including `components/schemas`
