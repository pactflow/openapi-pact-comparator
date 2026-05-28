import type Ajv from "ajv/dist/2019";
import type { AsyncAPIDocument, ResolvedMessage } from "#documents/asyncapi";
import { iterateMessages } from "#documents/asyncapi";
import type { AsyncInteraction } from "#documents/pact";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";
import { checkAsyncapiPreamble, tryMatchAllMessages } from "./matchMessages";

export function* compareAsyncInteraction(
  ajv: Ajv,
  asyncapi: AsyncAPIDocument | undefined,
  cache: Map<string, ResolvedMessage>,
  interaction: AsyncInteraction,
  index: number,
): Iterable<Result> {
  const preamble = checkAsyncapiPreamble(asyncapi, interaction, index, "async");
  if (!preamble.ok) {
    yield preamble.result;
    return;
  }

  yield* tryMatchAllMessages(
    ajv,
    preamble.asyncapi,
    iterateMessages(preamble.asyncapi, preamble.operationId, cache),
    interaction,
    interaction,
    {
      payload: `[root].interactions[${index}].contents.content`,
      headers: `[root].interactions[${index}].metadata`,
      spec: `[root].operations.${preamble.operationId}.messages`,
    },
    "response",
    {
      ...baseMockDetails(interaction),
      location: `[root].interactions[${index}]`,
      value: interaction.description,
    },
  );
}
