---
"@pactflow/openapi-pact-comparator": minor
---

Compare Avro and Protobuf payloads structurally as well as by value: the
consumer's schema embedded in the pact is compared with the provider's, as the
consumer's decoder will read the provider's messages (Protobuf by field and enum
number, Avro by writer/reader resolution), reported in field terms and without
repeating what the value comparison found. Also: fail with
`message.payload.uncomparable` instead of passing when a binary payload or
schema can't be compared, and check the consumer's and provider's types match
(`message.payload.type.incompatible`).
