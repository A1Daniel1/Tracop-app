export { AiAssistantModule } from './ai-assistant.module.js';
export {
  AI_CONSENT_PORT,
  ASSISTANT_CHANNEL_PORT,
  ASSISTANT_CLOCK,
  ASSISTANT_INBOX,
  ASSISTANT_INBOX_PROCESSOR,
  ASSISTANT_MAINTENANCE,
  ASSISTANT_USER_PORT,
  DRAFT_CATALOG_PORT,
  LLM_PORT,
} from './application/assistant-tokens.js';
export { INBOX_NOTIFY_CHANNEL } from './adapters/out/drizzle-assistant-repositories.js';
export { FakeLLMAdapter, fakeJson } from './adapters/out/fake-llm.adapter.js';
export type {
  AssistantInbox,
  AssistantInboundMessage,
  AssistantMaintenance,
  InboxProcessor,
} from './application/assistant-inbox.js';
export type {
  AiConsentPort,
  AssistantButton,
  AssistantChannelPort,
  AssistantUser,
  AssistantUserPort,
  CatalogCategory,
  ChannelRef,
  DraftCatalogPort,
  DraftLotInput,
  LLMPort,
  LLMRequest,
  LLMResult,
  ProviderLocation,
} from './ports/assistant-ports.js';
export type { DraftProduct } from './domain/lot-draft.js';
export type { LotUnit } from './domain/parsing.js';
