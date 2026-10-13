---
"@pactflow/openapi-pact-comparator": minor
---

Compare Avro and Protobuf payloads structurally as well as by value: the
consumer's schema embedded in the pact is compared with the provider's, as the
consumer's decoder will read the provider's messages (Protobuf by field and enum
number, Avro by writer/reader resolution), reported in field terms and
independently of the value comparison. Also report when the consumer's and
provider's messages are different types (`message.payload.type.incompatible`).
