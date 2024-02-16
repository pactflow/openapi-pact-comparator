export interface Interaction {
  description: string;
  providerState?: string;
  request: {
    body: unknown;
    headers: Record<string, string>;
    method: string;
    path: string;
    query?: string;
  };
  response: {
    body: unknown;
    headers: Record<string, string>;
    status: number;
  };
}

export interface Pact {
  interactions: Interaction[];
}
