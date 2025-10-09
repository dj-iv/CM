"use client";

import {
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";

type ProposalMetadata = {
  customerName?: string;
  solutionType?: string;
  quoteNumber?: string | null;
  totalPrice?: number | null;
  supportTier?: string | null;
  numberOfNetworks?: number | null;
} | null;

type ProposalListItem = {
  slug: string;
  metadata: ProposalMetadata;
  createdAt: string | null;
  updatedAt: string | null;
  pdf: { status?: string | null } | null;
  notes?: string;
  tags?: string[];
  expiresAt?: string | null;
  isArchived?: boolean;
  viewCount?: number;
  downloadCount?: number;
};

type Toast = {
  id: string;
  type: "success" | "error";
  message: string;
};

const MAX_TAG_LENGTH = 40;
const TOAST_DISMISS_MS = 4000;

const formatCurrency = (value: number | null | undefined): string => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "–";
  }
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) {
    return "–";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "–";
  }
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatExpiry = (iso: string | null | undefined): string => {
  if (!iso) {
    return "No expiry";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "No expiry";
  }
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
};

const parseTagsInput = (raw: string): string[] => {
  const seen = new Set<string>();
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag.length <= MAX_TAG_LENGTH)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 20);
};

const buildQueryString = (search: string): string => {
  const params = new URLSearchParams({ limit: "200" });
  const trimmed = search.trim();
  if (trimmed) {
    params.set("search", trimmed);
  }
  return params.toString();
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const data = await response.json();
    if (typeof data?.error === "string") {
      return data.error;
    }
  } catch (error) {
    console.warn("Failed to parse error response", error);
  }
  return `${response.status} ${response.statusText}`;
};

export default function Home() {
  const [authReady, setAuthReady] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  const [proposals, setProposals] = useState<ProposalListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [siteOrigin, setSiteOrigin] = useState<string>("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [expiryDraft, setExpiryDraft] = useState("");
  const [detailDirty, setDetailDirty] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    if (typeof window === "undefined") {
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    setToasts((current) => [...current, { id, ...toast }]);
    window.setTimeout(() => {
      dismissToast(id);
    }, TOAST_DISMISS_MS);
  }, [dismissToast]);

  const googleProvider = useMemo(() => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: "select_account",
      hd: "uctel.co.uk",
    });
    return provider;
  }, []);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | null = null;

    const auth = getFirebaseAuth();
    unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (!isMounted) {
        return;
      }
      if (firebaseUser) {
        setCurrentUserEmail(firebaseUser.email ?? firebaseUser.displayName ?? firebaseUser.uid);
        const token = await firebaseUser.getIdToken();
        setAuthToken(token);
      } else {
        setAuthToken(null);
        setCurrentUserEmail(null);
        setSelected(new Set());
        setDetailSlug(null);
      }
      setAuthReady(true);
    });

    const refreshInterval = window.setInterval(() => {
      const currentUser = auth.currentUser;
      if (currentUser) {
        currentUser.getIdToken(true).catch((error) => {
          console.warn("Failed to refresh ID token", error);
        });
      }
    }, 30 * 60 * 1000);

    return () => {
      isMounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
      window.clearInterval(refreshInterval);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSiteOrigin(window.location.origin);
    }
  }, []);

  const debouncedSearch = useMemo(() => {
    return searchQuery.trim().toLowerCase();
  }, [searchQuery]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchQuery(searchInput);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const loadProposals = useCallback(async (token: string, search: string, signal?: AbortSignal) => {
    setListLoading(true);
    setListError(null);
    try {
      const response = await fetch(`/api/proposals?${buildQueryString(search)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        signal,
      });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      const items: ProposalListItem[] = Array.isArray(data?.items) ? data.items : [];
      const normalised = items.map((item) => ({
        ...item,
        viewCount: typeof item.viewCount === "number" ? item.viewCount : 0,
        downloadCount: typeof item.downloadCount === "number" ? item.downloadCount : 0,
      }));
      setProposals(normalised);
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return;
      }
      console.error("Failed to load proposals", error);
      setListError((error as Error).message || "Unable to load proposals");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authToken) {
      return;
    }
    const controller = new AbortController();
    loadProposals(authToken, debouncedSearch, controller.signal);
    return () => controller.abort();
  }, [authToken, debouncedSearch, loadProposals]);

  useEffect(() => {
    setSelected((current) => {
      if (!current.size) {
        return current;
      }
      const next = new Set<string>();
      const available = new Set(proposals.map((item) => item.slug));
      current.forEach((slug) => {
        if (available.has(slug)) {
          next.add(slug);
        }
      });
      return next;
    });
  }, [proposals]);

  useEffect(() => {
    if (!detailSlug) {
      setNotesDraft("");
      setTagsDraft("");
      setExpiryDraft("");
      setDetailDirty(false);
      return;
    }

    if (detailDirty) {
      return;
    }

    const next = proposals.find((item) => item.slug === detailSlug);
    if (!next) {
      setDetailSlug(null);
      return;
    }

    setNotesDraft(next.notes ?? "");
    setTagsDraft((next.tags ?? []).join(", "));
    setExpiryDraft(next.expiresAt ? next.expiresAt.slice(0, 10) : "");
  }, [detailSlug, proposals, detailDirty]);

  const visibleSelectionCount = selected.size;
  const allVisibleSelected = proposals.length > 0 && proposals.every((item) => selected.has(item.slug));

  const handleToggleAll = () => {
    if (allVisibleSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(proposals.map((item) => item.slug)));
  };

  const handleToggleOne = (slug: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const buildProposalUrl = useCallback((slug: string): string => {
    if (typeof window !== "undefined") {
      const origin = siteOrigin || window.location.origin;
      return `${origin.replace(/\/$/, "")}/${slug}`;
    }
    return `/${slug}`;
  }, [siteOrigin]);

  const copyProposalLink = useCallback(async (slug: string) => {
    const url = buildProposalUrl(slug);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(url);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      pushToast({ type: "success", message: "Proposal link copied" });
    } catch (error) {
      console.error("Failed to copy proposal link", error);
      pushToast({ type: "error", message: "Unable to copy proposal link" });
    }
  }, [buildProposalUrl, pushToast]);

  const handleSignIn = async () => {
    try {
      const auth = getFirebaseAuth();
      await signInWithPopup(auth, googleProvider);
      setAuthError(null);
    } catch (error) {
      console.error("Failed to sign in", error);
      const message = (error as Error).message ?? "Sign-in failed";
      setAuthError(message);
      pushToast({ type: "error", message });
    }
  };

  const handleSignOut = async () => {
    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
      setAuthError(null);
      pushToast({ type: "success", message: "Signed out" });
    } catch (error) {
      console.error("Failed to sign out", error);
      const message = (error as Error).message ?? "Sign-out failed";
      pushToast({ type: "error", message });
    }
  };

  const handleBulkAction = useCallback(async (action: "archive" | "unarchive" | "delete" | "set-expiry" | "clear-expiry", token: string, slugs: string[], load: typeof loadProposals, search: string) => {
    if (!slugs.length) {
      return;
    }

    if (action === "delete") {
      const confirmed = window.confirm(`Delete ${slugs.length} proposal${slugs.length === 1 ? "" : "s"}? This action cannot be undone.`);
      if (!confirmed) {
        return;
      }
    }

    let expiresAtISO: string | null | undefined;
    if (action === "set-expiry") {
      const input = window.prompt("Set expiry date (YYYY-MM-DD)");
      if (!input) {
        return;
      }
      const trimmed = input.trim();
      const date = new Date(`${trimmed}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) {
        window.alert("Invalid date. Please use YYYY-MM-DD format.");
        return;
      }
      expiresAtISO = date.toISOString();
    }

    setBulkLoading(true);
    try {
      const response = await fetch("/api/proposals/bulk", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          slugs,
          ...(action === "set-expiry" ? { expiresAt: expiresAtISO } : {}),
        }),
      });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        throw new Error(errorMessage);
      }

      const result = await response.json();
      pushToast({
        type: "success",
        message: `Bulk action completed: ${result.updatedCount ?? slugs.length} processed${result.skipped?.length ? `, ${result.skipped.length} skipped` : ""}.`,
      });

      await load(token, search);
      setSelected(new Set());
      if (detailSlug && slugs.includes(detailSlug)) {
        setDetailSlug(null);
      }
    } catch (error) {
      console.error("Bulk action failed", error);
      pushToast({ type: "error", message: (error as Error).message || "Bulk action failed" });
    } finally {
      setBulkLoading(false);
    }
  }, [detailSlug, pushToast]);

  const handleSaveDetails = async () => {
    if (!authToken || !detailSlug) {
      return;
    }

    const tags = parseTagsInput(tagsDraft);
    const payload: Record<string, unknown> = {
      notes: notesDraft,
      tags,
    };

    if (expiryDraft) {
      const date = new Date(`${expiryDraft}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) {
        pushToast({ type: "error", message: "Expiry date must use YYYY-MM-DD format" });
        return;
      }
      payload.expiresAt = date.toISOString();
    } else {
      payload.expiresAt = null;
    }

    setDetailSaving(true);
    try {
      const response = await fetch(`/api/proposals/${detailSlug}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        throw new Error(errorMessage);
      }

      const result = await response.json();
      const nextNotes = typeof result.notes === "string" ? result.notes : (payload.notes as string) ?? "";
      const nextTags = Array.isArray(result.tags) ? result.tags : tags;
      const nextExpiresAt = typeof result.expiresAt === "string" || result.expiresAt === null
        ? result.expiresAt
        : (payload.expiresAt as string | null | undefined) ?? null;

      setProposals((current) => current.map((proposal) => {
        if (proposal.slug !== detailSlug) {
          return proposal;
        }
        return {
          ...proposal,
          notes: nextNotes,
          tags: nextTags,
          expiresAt: nextExpiresAt ?? null,
          isArchived: typeof result.isArchived === "boolean" ? result.isArchived : proposal.isArchived,
        };
      }));

      pushToast({ type: "success", message: "Proposal updated" });
      setDetailDirty(false);
    } catch (error) {
      console.error("Failed to update proposal", error);
      pushToast({ type: "error", message: (error as Error).message ?? "Update failed" });
    } finally {
      setDetailSaving(false);
    }
  };

  const activeProposal = detailSlug ? proposals.find((item) => item.slug === detailSlug) : null;

  const renderAuthGate = () => {
    if (!authReady) {
      return (
        <div className="flex h-screen items-center justify-center">
          <p className="text-lg font-semibold">Checking authentication…</p>
        </div>
      );
    }

    if (!authToken) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-6">
          <h1 className="text-2xl font-semibold">UCtel Proposal Admin</h1>
          <p className="text-center text-neutral-600 max-w-md">
            Sign in with your UCtel Google account to manage saved proposals, add notes, and run bulk actions.
          </p>
          <button
            type="button"
            onClick={handleSignIn}
            className="rounded-md bg-blue-600 px-6 py-3 text-white shadow hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            Sign in with Google
          </button>
            {authError && (
              <p className="text-sm text-red-600">{authError}</p>
          )}
        </div>
      );
    }

    return null;
  };

  const authGate = renderAuthGate();
  if (authGate) {
    return authGate;
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="flex flex-col gap-2 border-b border-neutral-200 bg-white px-6 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Proposal management</h1>
          <p className="text-sm text-neutral-600">Search, tag, and maintain saved proposals.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-neutral-600">{currentUserEmail}</div>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="pointer-events-none fixed top-4 right-4 z-50 flex max-w-sm flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-md border px-4 py-3 shadow ${toast.type === "success" ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}`}
          >
            <div className="flex items-start gap-3">
              <span className="flex-1 text-sm">{toast.message}</span>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismissToast(toast.id)}
                className="rounded-full p-1 text-xs text-current/80 transition hover:bg-white/40"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6">
        <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 items-center gap-3">
              <input
                type="search"
                placeholder="Search by customer, quote number, or tag"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <button
                type="button"
                onClick={() => loadProposals(authToken!, searchInput)}
                className="hidden rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 lg:inline-flex"
              >
                Refresh
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleBulkAction("archive", authToken!, Array.from(selected), loadProposals, debouncedSearch)}
                disabled={!visibleSelectionCount || bulkLoading}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-neutral-100"
              >
                Archive
              </button>
              <button
                type="button"
                onClick={() => handleBulkAction("unarchive", authToken!, Array.from(selected), loadProposals, debouncedSearch)}
                disabled={!visibleSelectionCount || bulkLoading}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-neutral-100"
              >
                Unarchive
              </button>
              <button
                type="button"
                onClick={() => handleBulkAction("set-expiry", authToken!, Array.from(selected), loadProposals, debouncedSearch)}
                disabled={!visibleSelectionCount || bulkLoading}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-neutral-100"
              >
                Set expiry
              </button>
              <button
                type="button"
                onClick={() => handleBulkAction("clear-expiry", authToken!, Array.from(selected), loadProposals, debouncedSearch)}
                disabled={!visibleSelectionCount || bulkLoading}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-neutral-100"
              >
                Clear expiry
              </button>
              <button
                type="button"
                onClick={() => handleBulkAction("delete", authToken!, Array.from(selected), loadProposals, debouncedSearch)}
                disabled={!visibleSelectionCount || bulkLoading}
                className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-neutral-200">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left">
                <tr>
                  <th className="w-12 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      aria-label="Select all proposals"
                      onChange={handleToggleAll}
                    />
                  </th>
                  <th className="px-3 py-2 font-semibold">Customer</th>
                  <th className="px-3 py-2 font-semibold">Solution</th>
                  <th className="px-3 py-2 font-semibold">Networks</th>
                  <th className="px-3 py-2 font-semibold">Total</th>
                  <th className="px-3 py-2 font-semibold">Notes</th>
                  <th className="px-3 py-2 font-semibold">Expiry</th>
                  <th className="px-3 py-2 font-semibold">Updated</th>
                  <th className="px-3 py-2 font-semibold text-center">Opens</th>
                  <th className="px-3 py-2 font-semibold text-center">Downloads</th>
                  <th className="px-3 py-2 font-semibold text-center">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {proposals.map((proposal) => {
                  const isSelected = selected.has(proposal.slug);
                  const isArchived = Boolean(proposal.isArchived);
                  return (
                    <tr
                      key={proposal.slug}
                      className={`${isSelected ? "bg-blue-50" : "bg-white"} ${isArchived ? "opacity-70" : ""}`}
                      onClick={() => {
                        setDetailSlug((current) => (current === proposal.slug ? current : proposal.slug));
                        setDetailDirty(false);
                      }}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) => {
                            event.stopPropagation();
                            handleToggleOne(proposal.slug);
                          }}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-neutral-900">{proposal.metadata?.customerName ?? "—"}</span>
                          <a
                            href={`/${proposal.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-blue-600 hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {proposal.slug}
                          </a>
                          {isArchived && <span className="mt-1 inline-flex items-center rounded-md bg-neutral-200 px-2 py-0.5 text-[11px] font-medium uppercase text-neutral-700">Archived</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-neutral-700">{proposal.metadata?.solutionType ?? "—"}</td>
                      <td className="px-3 py-3 text-neutral-700">{typeof proposal.metadata?.numberOfNetworks === "number" ? proposal.metadata.numberOfNetworks : "—"}</td>
                      <td className="px-3 py-3 text-neutral-700">{formatCurrency(proposal.metadata?.totalPrice ?? null)}</td>
                      <td className="px-3 py-3 text-neutral-700">
                        {proposal.notes?.trim() ? proposal.notes.trim().slice(0, 80) + (proposal.notes.trim().length > 80 ? "…" : "") : "—"}
                      </td>
                      <td className="px-3 py-3 text-neutral-700">{formatExpiry(proposal.expiresAt)}</td>
                      <td className="px-3 py-3 text-neutral-700">{formatDateTime(proposal.updatedAt)}</td>
                      <td className="px-3 py-3 text-center text-neutral-700">{proposal.viewCount ?? 0}</td>
                      <td className="px-3 py-3 text-center text-neutral-700">{proposal.downloadCount ?? 0}</td>
                      <td className="px-3 py-3 text-center">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-full border border-neutral-300 bg-white p-2 text-neutral-600 hover:bg-neutral-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyProposalLink(proposal.slug);
                          }}
                          aria-label="Copy proposal link"
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M9 7.5V6a2.25 2.25 0 0 1 2.25-2.25h5.25A2.25 2.25 0 0 1 18.75 6v9A2.25 2.25 0 0 1 16.5 17.25H15" />
                            <path d="M6.75 7.5h5.25A2.25 2.25 0 0 1 14.25 9.75v7.5A2.25 2.25 0 0 1 12 19.5H6.75A2.25 2.25 0 0 1 4.5 17.25V9.75A2.25 2.25 0 0 1 6.75 7.5z" />
                          </svg>
                          <span className="sr-only">Copy proposal link</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!listLoading && !proposals.length && (
              <div className="p-6 text-center text-sm text-neutral-500">No proposals found. Adjust your filters and try again.</div>
            )}
            {listLoading && (
              <div className="p-6 text-center text-sm text-neutral-500">Loading proposals…</div>
            )}
            {listError && (
              <div className="p-6 text-center text-sm text-red-600">{listError}</div>
            )}
          </div>

          <div className="flex items-center justify-between text-sm text-neutral-600">
            <span>{proposals.length} proposals</span>
            <span>{visibleSelectionCount} selected</span>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-semibold">Details</h2>
            {activeProposal ? (
              <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-neutral-500">Customer</dt>
                  <dd className="font-medium text-neutral-900">{activeProposal.metadata?.customerName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Slug</dt>
                  <dd className="font-medium text-neutral-900">{activeProposal.slug}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Solution</dt>
                  <dd className="font-medium text-neutral-900">{activeProposal.metadata?.solutionType ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Quote number</dt>
                  <dd className="font-medium text-neutral-900">{activeProposal.metadata?.quoteNumber ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Support tier</dt>
                  <dd className="font-medium text-neutral-900">{activeProposal.metadata?.supportTier ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Networks</dt>
                  <dd className="font-medium text-neutral-900">{activeProposal.metadata?.numberOfNetworks ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">PDF status</dt>
                  <dd className="font-medium text-neutral-900">{activeProposal.pdf?.status ?? "not generated"}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Created</dt>
                  <dd className="font-medium text-neutral-900">{formatDateTime(activeProposal.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Opens</dt>
                  <dd className="font-medium text-neutral-900">{activeProposal.viewCount ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Downloads</dt>
                  <dd className="font-medium text-neutral-900">{activeProposal.downloadCount ?? 0}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-neutral-500">Select a proposal to view additional details.</p>
            )}
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-semibold">Notes & tags</h2>
            {activeProposal ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveDetails();
                }}
              >
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-600">Internal notes</span>
                  <textarea
                    value={notesDraft}
                    onChange={(event) => {
                      setNotesDraft(event.target.value);
                      setDetailDirty(true);
                    }}
                    rows={5}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="Add context for sales or delivery teams"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-600">Tags (comma separated)</span>
                  <input
                    type="text"
                    value={tagsDraft}
                    onChange={(event) => {
                      setTagsDraft(event.target.value);
                      setDetailDirty(true);
                    }}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="e.g. priority, follow-up"
                  />
                  <span className="text-xs text-neutral-500">Up to 20 tags, {MAX_TAG_LENGTH} characters each.</span>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-600">Expiry date (optional)</span>
                  <input
                    type="date"
                    value={expiryDraft}
                    onChange={(event) => {
                      setExpiryDraft(event.target.value);
                      setDetailDirty(true);
                    }}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </label>

                <button
                  type="submit"
                  disabled={detailSaving || !detailDirty}
                  className="mt-2 inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {detailSaving ? "Saving…" : "Save changes"}
                </button>
              </form>
            ) : (
              <p className="text-sm text-neutral-500">Choose a proposal to edit notes and tags.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
