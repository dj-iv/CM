import { randomUUID } from "node:crypto";
import pako from "pako";
import { z } from "zod";

export type ProposalPayload = Record<string, unknown>;

export interface ProposalMetadata {
  customerName: string;
  customerNameLower: string;
  description: string | null;
  solutionType: string;
  numberOfNetworks: number | null;
  quoteNumber: string | null;
  totalPrice: number | null;
  supportTier: string | null;
}

export interface DecodedState {
  inputs?: Record<string, unknown>;
  support?: {
    activePreset?: string | null;
  };
}

const currencyPattern = /[^0-9.-]/g;

export const parseCurrency = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const asString = typeof value === "string" ? value : String(value);
  const cleaned = asString.replace(currencyPattern, "");
  if (!cleaned) {
    return null;
  }
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const sanitizeSlug = (input: string): string => {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
};

export const randomSlug = (): string => {
  return `p-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
};

const decodedStateSchema = z
  .object({
  inputs: z.record(z.string(), z.unknown()).optional(),
    support: z
      .object({
        activePreset: z.string().optional().nullable(),
      })
      .optional(),
  })
  .passthrough();

export const decodeState = (encoded: string): DecodedState | null => {
  if (!encoded) {
    return null;
  }
  try {
    const buffer = Buffer.from(encoded, "base64");
    const inflated = pako.inflate(buffer, { to: "string" });
    const parsed = JSON.parse(inflated);
    const result = decodedStateSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }
    return result.data;
  } catch (error) {
    console.error("Failed to decode proposal state", error);
    return null;
  }
};

const getInputString = (state: DecodedState | null, key: string): string | null => {
  if (!state || !state.inputs) {
    return null;
  }
  const value = state.inputs[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return null;
};

export const buildMetadata = (proposal: ProposalPayload, state: DecodedState | null): ProposalMetadata => {
  const customerNameRaw =
    (typeof proposal.Account === "string" && proposal.Account) ||
    (typeof proposal.CustomerName === "string" && proposal.CustomerName) ||
    "";
  const customerName = customerNameRaw.trim();

  const descriptionRaw =
    (typeof proposal.Description === "string" && proposal.Description) ||
    getInputString(state, "proposal-description") ||
    "";
  const description = descriptionRaw.trim() || null;

  const solutionTypeRaw =
    (typeof proposal.Solution === "string" && proposal.Solution) ||
    (typeof proposal.systemType === "string" && proposal.systemType) ||
    "";
  const solutionType = solutionTypeRaw.trim();

  const numberOfNetworks = toNumber(proposal.NumberOfNetworks);
  const quoteNumber = getInputString(state, "quote-number") || null;
  const totalPrice = parseCurrency(proposal.TotalPrice ?? proposal.totalPrice ?? null);
  const supportTier = state?.support?.activePreset ?? null;

  return {
    customerName,
    customerNameLower: customerName.toLowerCase(),
    description,
    solutionType,
    numberOfNetworks,
    quoteNumber,
    totalPrice,
    supportTier,
  };
};

export interface EnsureSlugParams {
  requestedSlug?: string | null;
  quoteNumber?: string | null;
  customerName?: string;
}

export const ensureSlug = ({ requestedSlug, quoteNumber, customerName }: EnsureSlugParams): string => {
  const candidates = [requestedSlug, quoteNumber, customerName].filter((value): value is string => Boolean(value && value.trim()));

  for (const candidate of candidates) {
    const sanitized = sanitizeSlug(candidate);
    if (sanitized) {
      return sanitized;
    }
  }

  return randomSlug();
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const formatDateForFilename = (date = new Date()): string => {
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  return `${day}${month}${year}`;
};

export const sanitizeFilenameSegment = (value: string): string =>
  value.trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");

export const buildProposalFilename = (metadata: ProposalMetadata, date = new Date()): string => {
  const solution = sanitizeFilenameSegment(metadata.solutionType || "Solution");
  const networks = metadata.numberOfNetworks !== null && metadata.numberOfNetworks !== undefined
    ? sanitizeFilenameSegment(String(metadata.numberOfNetworks))
    : "Networks";
  const customer = sanitizeFilenameSegment(metadata.customerName || "Customer");
  const dateStamp = formatDateForFilename(date);
  return `UCtel_Proposal_${solution}_${networks}_Networks_for_${customer}_${dateStamp}`;
};
