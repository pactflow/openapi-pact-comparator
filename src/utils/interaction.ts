import type { HttpInteraction } from "../documents/pact";

export const isValidRequest = (interaction: HttpInteraction): boolean =>
  interaction.response.status < 400;
