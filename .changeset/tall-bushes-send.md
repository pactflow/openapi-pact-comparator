---
"@pactflow/openapi-pact-comparator": major
---

Add AsyncAPI 3.x support for async and synchronous message contract testing

## Breaking Changes

- **`Comparator` constructor** — previously accepted a single positional OAS document argument (`new Comparator(oas)`); now accepts an options object (`new Comparator({ oas?, asyncapi? })`). At least one of `oas` or `asyncapi` must be provided.

- **CLI** — the OAS file path was previously a required positional argument (`opc <oas> <pact...>`); it is now a named option (`opc --oas <path> <pact...>`). Use `--asyncapi <path>` instead of or alongside `--oas` to pass an AsyncAPI document.

## New Features

- **`Asynchronous/Messages`** — validates async Pact v4 interactions against the corresponding AsyncAPI 3.x operation, checking payload and headers against all messages defined on that operation.

- **`Synchronous/Messages`** — validates synchronous (request + response) Pact v4 interactions. The request is validated against the operation's messages; the response is validated against the messages defined in `operation.reply`.

- Both interaction types use `operationId` only for matching — a message is considered matched if the interaction payload and headers are compatible with _any_ message defined on the operation; no `messageId` is needed in the pact file.

- Full `$ref` resolution for message payload and header schemas, including `components/schemas` and `components/messages`.

## New Result Codes

| Code                       | Type    | Description                                                                    |
| -------------------------- | ------- | ------------------------------------------------------------------------------ |
| `message.matched`          | info    | The interaction matched a message in the spec                                  |
| `message.no.match`         | error   | No message in the operation matched the interaction, with per-candidate causes |
| `message.reply.missing`    | error   | The referenced operation has no `reply` field (sync interactions only)         |
| `message.response.missing` | warning | A sync interaction defines no responses to validate                            |
