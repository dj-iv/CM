const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const readValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  return "";
};

const readProposalString = (proposal: Record<string, unknown> | null | undefined, keys: string[]): string => {
  if (!proposal) {
    return "";
  }
  for (const key of keys) {
    if (key in proposal) {
      const value = proposal[key];
      const normalized = readValue(value);
      if (normalized) {
        return normalized;
      }
    }
  }
  return "";
};

const DEFAULT_CUSTOMER = "your organisation";
const DEFAULT_SOLUTION = "Solution";
const DEFAULT_NETWORKS = "—";

export const INTRODUCTION_MAX_LENGTH = 4000;

export const buildDefaultIntroduction = (proposal: Record<string, unknown> | null | undefined): string => {
  const customer = readProposalString(proposal, ["Account", "CustomerName", "customerName"]) || DEFAULT_CUSTOMER;
  const solution = readProposalString(proposal, ["Solution", "solution", "solutionType", "systemType"]) || DEFAULT_SOLUTION;
  const networks =
    readProposalString(proposal, ["NumberOfNetworks", "numberOfNetworks"]) || DEFAULT_NETWORKS;

  return `UCtel is pleased to present this proposal to provide a comprehensive mobile signal solution for <strong>${escapeHtml(customer)}</strong>, designed to deliver reliable, high-quality indoor coverage for your staff and visitors. Coverage is required over ${escapeHtml(networks)} of the UK Mobile Network Operators (MNOs) – EE, O2, Vodafone and Three (3). Based on the information provided, UCtel proposes the use of the CEL-FI ${escapeHtml(solution)} solution. This document sets out the details of the proposed solution, UCtel’s approach and budgetary pricing.`;
};

export const normalizeIntroductionInput = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length > INTRODUCTION_MAX_LENGTH) {
    return normalized.slice(0, INTRODUCTION_MAX_LENGTH);
  }
  return normalized;
};
