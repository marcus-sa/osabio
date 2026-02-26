export type EntityKind = "task" | "decision" | "question";

export type ChatMessageRequest = {
  clientMessageId: string;
  conversationId?: string;
  text: string;
};

export type ChatMessageResponse = {
  messageId: string;
  conversationId: string;
  streamUrl: string;
};

export type ExtractedEntity = {
  id: string;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceMessageId: string;
};

export type ExtractedRelationship = {
  id: string;
  kind: string;
  fromId: string;
  toId: string;
  confidence: number;
  sourceMessageId: string;
  fromText?: string;
  toText?: string;
};

export type TokenEvent = {
  type: "token";
  messageId: string;
  token: string;
};

export type AssistantMessageEvent = {
  type: "assistant_message";
  messageId: string;
  text: string;
};

export type ExtractionEvent = {
  type: "extraction";
  messageId: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
};

export type DoneEvent = {
  type: "done";
  messageId: string;
};

export type ErrorEvent = {
  type: "error";
  messageId: string;
  error: string;
};

export type StreamEvent = TokenEvent | AssistantMessageEvent | ExtractionEvent | DoneEvent | ErrorEvent;

export type SearchEntityResponse = {
  id: string;
  kind: EntityKind;
  text: string;
  confidence: number;
  sourceMessageId: string;
};
