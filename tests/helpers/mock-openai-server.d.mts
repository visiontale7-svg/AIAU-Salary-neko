export interface MockOpenAiRequest {
  at: string;
  method?: string;
  url?: string;
  authorizationPresent: boolean;
  store?: boolean;
  background?: boolean;
  schemaName?: string;
  body?: Record<string, unknown>;
}

export interface MockOpenAiServer {
  baseUrl: string;
  expectedKey: string;
  requests: MockOpenAiRequest[];
  close(): Promise<void>;
}

export function createMockOpenAiServer(options?: {
  scenario?: "success" | "partial" | "invalid_evidence" | "retry_once" | "slow";
  expectedKey?: string;
  logPath?: string;
  delayMs?: number;
}): Promise<MockOpenAiServer>;
