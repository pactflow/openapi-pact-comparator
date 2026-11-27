import {
  type AsyncAPIDocument,
  channelProtocols,
  resolveOperationChannel,
} from "#documents/asyncapi";
import type { Result } from "#results/index";
import { baseMockDetails } from "#results/index";

import {
  defaultDestinationRegistry,
  type DestinationRegistry,
} from "./destination/registry";

export function* compareMessageDestination(
  asyncapi: AsyncAPIDocument,
  operationId: string,
  metadata: Record<string, string> | undefined,
  interactionContext: { description?: string; providerState?: string },
  metadataLocation: string,
  registry: DestinationRegistry = defaultDestinationRegistry,
): Iterable<Result> {
  const destination = metadata?.destination;
  if (typeof destination !== "string") {
    return;
  }
  const resolved = resolveOperationChannel(asyncapi, operationId);
  if (!resolved) {
    return;
  }
  const { channel, path } = resolved;
  const handler = registry.forProtocols(channelProtocols(asyncapi, channel));
  const check = handler.check(destination, channel);

  const mockDetails = {
    ...baseMockDetails(interactionContext),
    location: `${metadataLocation}.destination`,
    value: destination,
  };

  if (check.status === "mismatch") {
    yield {
      code: "message.destination.incompatible",
      message: `Message destination "${destination}" does not match ${check.against} "${check.expected}"`,
      mockDetails,
      specDetails: {
        location: `${path}${check.spec.location}`,
        value: check.spec.value,
      },
      type: "error",
    };
  } else if (check.status === "unvalidatable") {
    yield {
      code: "message.destination.unvalidatable",
      message: `Message destination was not compared: ${check.reason}`,
      mockDetails,
      specDetails: {
        location: `${path}${check.spec.location}`,
        value: check.spec.value,
      },
      type: "warning",
    };
  }
}
