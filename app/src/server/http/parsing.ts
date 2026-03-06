import type { CreateWorkspaceRequest, OnboardingAction } from "../../shared/contracts";
import { HttpError } from "./errors";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const allowedUploadExtensions = new Set(["md", "txt"]);

export type IncomingAttachment = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  content: string;
};

export type ParsedIncomingMessage = {
  clientMessageId: string;
  workspaceId: string;
  conversationId?: string;
  text: string;
  onboardingAction?: OnboardingAction;
  attachment?: IncomingAttachment;
  discussEntityId?: string;
};

const onboardingActions = new Set(["finalize_onboarding", "continue_onboarding"]);

export function parseCreateWorkspaceRequest(body: unknown):
  | { ok: true; data: CreateWorkspaceRequest }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object" };
  }

  const payload = body as Partial<CreateWorkspaceRequest>;

  if (!payload.name || payload.name.trim().length === 0) {
    return { ok: false, error: "name is required" };
  }

  const description = typeof payload.description === "string" ? payload.description.trim() : undefined;

  return {
    ok: true,
    data: {
      name: payload.name.trim(),
      ...(description && description.length > 0 ? { description } : {}),
    },
  };
}

export async function parseIncomingMessageRequest(
  request: Request,
): Promise<{ ok: true; data: ParsedIncomingMessage } | { ok: false; error: string }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();

    const clientMessageIdValue = formData.get("clientMessageId");
    const workspaceIdValue = formData.get("workspaceId");
    const conversationIdValue = formData.get("conversationId");
    const textValue = formData.get("text");
    const onboardingActionValue = formData.get("onboardingAction");
    const discussEntityIdValue = formData.get("discussEntityId");

    if (typeof clientMessageIdValue !== "string" || clientMessageIdValue.trim().length === 0) {
      return { ok: false, error: "clientMessageId is required" };
    }

    if (typeof workspaceIdValue !== "string" || workspaceIdValue.trim().length === 0) {
      return { ok: false, error: "workspaceId is required" };
    }

    const text = typeof textValue === "string" ? textValue.trim() : "";

    const fileValue = formData.get("file");
    let attachment: IncomingAttachment | undefined;
    if (fileValue instanceof File) {
      try {
        attachment = await parseIncomingAttachment(fileValue);
      } catch (error) {
        if (error instanceof HttpError) {
          return { ok: false, error: error.message };
        }
        throw error;
      }
    }

    if (!attachment && text.length === 0) {
      return { ok: false, error: "text is required when no file is uploaded" };
    }

    const conversationId =
      typeof conversationIdValue === "string" && conversationIdValue.trim().length > 0
        ? conversationIdValue.trim()
        : undefined;
    const onboardingAction = typeof onboardingActionValue === "string" && onboardingActionValue.trim().length > 0
      ? onboardingActionValue.trim()
      : undefined;
    if (onboardingAction && !onboardingActions.has(onboardingAction)) {
      return { ok: false, error: "onboardingAction must be finalize_onboarding or continue_onboarding" };
    }

    const discussEntityId =
      typeof discussEntityIdValue === "string" && discussEntityIdValue.trim().length > 0
        ? discussEntityIdValue.trim()
        : undefined;

    return {
      ok: true,
      data: {
        clientMessageId: clientMessageIdValue.trim(),
        workspaceId: workspaceIdValue.trim(),
        ...(conversationId ? { conversationId } : {}),
        text,
        ...(onboardingAction ? { onboardingAction: onboardingAction as OnboardingAction } : {}),
        ...(attachment ? { attachment } : {}),
        ...(discussEntityId ? { discussEntityId } : {}),
      },
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON" };
  }

  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object" };
  }

  const payload = body as Partial<ParsedIncomingMessage>;

  if (!payload.clientMessageId || payload.clientMessageId.trim().length === 0) {
    return { ok: false, error: "clientMessageId is required" };
  }

  if (!payload.workspaceId || payload.workspaceId.trim().length === 0) {
    return { ok: false, error: "workspaceId is required" };
  }

  if (!payload.text || payload.text.trim().length === 0) {
    return { ok: false, error: "text is required" };
  }

  if (payload.conversationId && payload.conversationId.trim().length === 0) {
    return { ok: false, error: "conversationId must not be empty when provided" };
  }

  if (payload.onboardingAction && !onboardingActions.has(payload.onboardingAction)) {
    return { ok: false, error: "onboardingAction must be finalize_onboarding or continue_onboarding" };
  }

  const discussEntityId = (body as Record<string, unknown>).discussEntityId;

  return {
    ok: true,
    data: {
      clientMessageId: payload.clientMessageId.trim(),
      workspaceId: payload.workspaceId.trim(),
      ...(payload.conversationId ? { conversationId: payload.conversationId.trim() } : {}),
      text: payload.text.trim(),
      ...(payload.onboardingAction ? { onboardingAction: payload.onboardingAction } : {}),
      ...(typeof discussEntityId === "string" && discussEntityId.trim().length > 0
        ? { discussEntityId: discussEntityId.trim() }
        : {}),
    },
  };
}

async function parseIncomingAttachment(file: File): Promise<IncomingAttachment> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, `file is too large, max size is ${MAX_UPLOAD_BYTES} bytes`);
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !allowedUploadExtensions.has(extension)) {
    throw new HttpError(400, "only .md and .txt files are supported in phase 1");
  }

  const content = (await file.text()).trim();
  if (content.length === 0) {
    throw new HttpError(400, "uploaded file content is empty");
  }

  return {
    fileName: file.name,
    mimeType: file.type.trim().length > 0 ? file.type : "text/plain",
    sizeBytes: file.size,
    content,
  };
}
