import type { Interaction } from "../documents/pact";

export const isValidRequest = (interaction: Interaction): boolean =>
  interaction.response.status < 400;
