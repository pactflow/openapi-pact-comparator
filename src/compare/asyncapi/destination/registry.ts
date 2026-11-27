import { amqp } from "./amqp";
import { generic } from "./generic";
import { kafka } from "./kafka";
import { nats } from "./nats";
import type { DestinationProtocol } from "./types";

export interface DestinationRegistry {
  forProtocols(protocols: string[]): DestinationProtocol;
}

export const createDestinationRegistry = (
  handlers: DestinationProtocol[],
  fallback: DestinationProtocol,
): DestinationRegistry => {
  const byProtocol = new Map<string, DestinationProtocol>();
  for (const handler of handlers) {
    for (const protocol of handler.protocols) {
      const key = protocol.toLowerCase();
      if (byProtocol.has(key)) {
        throw new Error(`Duplicate destination handler for protocol "${key}"`);
      }
      byProtocol.set(key, handler);
    }
  }
  return {
    forProtocols(protocols) {
      const found = new Set(
        protocols.map((p) => byProtocol.get(p.toLowerCase()) ?? fallback),
      );
      return found.size === 1 ? [...found][0] : fallback;
    },
  };
};

export const defaultDestinationRegistry = createDestinationRegistry(
  [nats, kafka, amqp],
  generic,
);
