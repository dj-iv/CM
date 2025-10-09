import pako from "pako";
import { FieldValue } from "firebase-admin/firestore";
import ProposalClient from "./ProposalClient";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

interface ProposalPageProps {
  params: Promise<{ slug: string }> | { slug: string };
  searchParams: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}

export interface DecodedProposal {
  [key: string]: unknown;
}

const PROPOSAL_HINT_KEYS = [
  "Account",
  "account",
  "CustomerName",
  "customerName",
  "Solution",
  "solutionType",
  "TotalPrice",
  "totalPrice",
  "Description1",
  "description1",
  "GrandTotal",
  "grandTotal",
  "NumberOfNetworks",
  "numberOfNetworks",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasLikelyProposalShape = (value: unknown): value is DecodedProposal => {
  if (!isRecord(value)) {
    return false;
  }

  return PROPOSAL_HINT_KEYS.some((key) => key in value);
};

function decodePayload(encoded: string | undefined): { proposal: DecodedProposal | null; error: string | null } {
  if (!encoded) {
    return { proposal: null, error: "No payload provided." };
  }

  try {
    const compressed = Buffer.from(encoded, "base64");
    const json = pako.inflate(compressed, { to: "string" });
    const parsed = JSON.parse(json) as unknown;

    if (hasLikelyProposalShape(parsed)) {
      return { proposal: parsed, error: null };
    }

    if (isRecord(parsed) && hasLikelyProposalShape(parsed["proposal"])) {
      return { proposal: parsed["proposal"] as DecodedProposal, error: null };
    }

    if (isRecord(parsed) && ("inputs" in parsed || "overrides" in parsed || "support" in parsed)) {
      return { proposal: null, error: "Decoded payload contained calculator state but no proposal data." };
    }

    return { proposal: null, error: "Decoded payload did not contain proposal data." };
  } catch (err) {
    console.error("Failed to decode proposal payload", err);
    return { proposal: null, error: "Could not decode proposal payload." };
  }
}

async function loadProposalFromFirestore(slug: string): Promise<{ proposal: DecodedProposal | null; error: string | null }> {
  if (!slug) {
    return { proposal: null, error: "Proposal slug is required." };
  }

  try {
    const firestore = getAdminFirestore();
    const docRef = firestore.collection("proposals").doc(slug);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      return { proposal: null, error: `Proposal not found for slug "${slug}".` };
    }

    const data = snapshot.data() ?? {};
    try {
      await docRef.update({
        viewCount: FieldValue.increment(1),
      });
    } catch (err) {
      console.error(`Failed to increment view count for slug ${slug}`, err);
    }
    const encodedState = typeof data.encodedState === "string" ? data.encodedState : undefined;
  const storedProposalRaw = data.proposal as unknown;
  const storedProposal = hasLikelyProposalShape(storedProposalRaw) ? (storedProposalRaw as DecodedProposal) : null;
  const storedProposalFallback = isRecord(storedProposalRaw) ? (storedProposalRaw as DecodedProposal) : null;

    if (storedProposal) {
      return { proposal: storedProposal, error: null };
    }

    if (encodedState) {
      const decoded = decodePayload(encodedState);
      if (decoded.proposal) {
        return decoded;
      }

      if (storedProposalFallback) {
        return { proposal: storedProposalFallback, error: decoded.error };
      }

      return decoded;
    }

    if (storedProposalFallback) {
      return { proposal: storedProposalFallback, error: "Proposal document contains unrecognised proposal data." };
    }

    return { proposal: null, error: `Proposal document for slug "${slug}" is missing payload data.` };
  } catch (err) {
    console.error(`Failed to load proposal for slug ${slug}`, err);
    const message = err instanceof Error ? err.message : "Unknown error while loading proposal.";
    return { proposal: null, error: `Failed to load proposal: ${message}` };
  }
}

export default async function ProposalPage(props: ProposalPageProps) {
  const [resolvedParams, resolvedSearchParams] = await Promise.all([
    props.params instanceof Promise ? props.params : Promise.resolve(props.params),
    props.searchParams instanceof Promise ? props.searchParams : Promise.resolve(props.searchParams),
  ]);

  const rawPayload = typeof resolvedSearchParams.payload === "string" ? resolvedSearchParams.payload : undefined;
  let result = decodePayload(rawPayload);

  if (!result.proposal) {
    const fallback = await loadProposalFromFirestore(resolvedParams.slug);
    if (fallback.proposal || fallback.error) {
      result = fallback;
    }
  }

  return <ProposalClient slug={resolvedParams.slug} proposal={result.proposal} error={result.error} />;
}
