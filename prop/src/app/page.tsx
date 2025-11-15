"use client";

import { onIdTokenChanged, signInWithCustomToken, signOut } from "firebase/auth";
import Image from "next/image";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import { ALLOWED_EMAIL_DOMAINS, isEmailAllowed } from "@/lib/accessControl";
import { INTRODUCTION_MAX_LENGTH } from "@/lib/proposalCopy";
import type {
  AntennaPlacementAntenna,
  AntennaPlacementCoveragePolygon,
  AntennaPlacementFloorSnapshot,
  AntennaPlacementSnapshot,
  LengthUnit,
} from "@/types/antennaPlacement";
import type { FloorSummary, ProjectSummary } from "@/lib/antennaProjects";

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
  expiresAt?: string | null;
  isArchived?: boolean;
  viewCount?: number;
  downloadCount?: number;
  createdBy?: { firstName?: string | null; displayName: string | null; email: string | null } | null;
  introduction?: string | null;
  antennaPlacement?: AntennaPlacementSnapshot | null;
};

type ProposalEvent = {
  id: string;
  type: "open" | "download";
  email: string | null;
  createdAt: string | null;
};

type Toast = {
  id: string;
  type: "success" | "error";
  message: string;
};

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

const normalizeLengthUnit = (value: unknown): LengthUnit => {
  if (typeof value !== "string") {
    return "meters";
  }
  const normalised = value.toLowerCase();
  if (normalised === "feet" || normalised === "ft") {
    return "feet";
  }
  if (normalised === "cm") {
    return "cm";
  }
  if (normalised === "mm") {
    return "mm";
  }
  return "meters";
};

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
};

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const toNonNegativeInteger = (value: unknown, fallback = 0): number => {
  const numeric = Math.floor(toFiniteNumber(value, fallback));
  return numeric >= 0 ? numeric : fallback;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const computeCoverageBoundsFromPolygons = (
  polygons: AntennaPlacementCoveragePolygon[],
): AntennaPlacementFloorSnapshot["coverageBounds"] => {
  if (!Array.isArray(polygons) || !polygons.length) {
    return null;
  }

  const xs: number[] = [];
  const ys: number[] = [];

  polygons.forEach((polygon) => {
    polygon.points.forEach((point) => {
      if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
        return;
      }
      xs.push(clamp(point.x, 0, 1));
      ys.push(clamp(point.y, 0, 1));
    });
  });

  if (!xs.length || !ys.length) {
    return null;
  }

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  if (maxX <= minX || maxY <= minY) {
    return null;
  }

  return { minX, minY, maxX, maxY };
};

const UNIT_AREA_SUFFIX: Record<LengthUnit, string> = {
  meters: "m²",
  feet: "ft²",
  cm: "cm²",
  mm: "mm²",
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

const formatEventDateTime = (iso: string | null): string => {
  if (!iso) {
    return "Unknown time";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [introductionDraft, setIntroductionDraft] = useState("");
  const [expiryDraft, setExpiryDraft] = useState("");
  const [detailDirty, setDetailDirty] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [projectListLoading, setProjectListLoading] = useState(false);
  const [projectSearchInput, setProjectSearchInput] = useState("");
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectFloors, setProjectFloors] = useState<FloorSummary[]>([]);
  const [projectFloorsLoading, setProjectFloorsLoading] = useState(false);
  const [selectedFloorIds, setSelectedFloorIds] = useState<Set<string>>(new Set());
  const [placementNotes, setPlacementNotes] = useState("");
  const [placementSaving, setPlacementSaving] = useState(false);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [placementDirty, setPlacementDirty] = useState(false);

  const [hoverEvents, setHoverEvents] = useState<ProposalEvent[] | null>(null);
  const [hoverEventsLoading, setHoverEventsLoading] = useState(false);
  const [hoverEventsError, setHoverEventsError] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<{ slug: string; type: "open" | "download" } | null>(null);
  const [activityResetting, setActivityResetting] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authExchangeInFlight, setAuthExchangeInFlight] = useState(false);
  const portalSignInPromiseRef = useRef<Promise<void> | null>(null);

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

  const beginPortalSignIn = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }

    if (portalSignInPromiseRef.current) {
      return portalSignInPromiseRef.current;
    }

    const auth = getFirebaseAuth();
    if (auth.currentUser) {
      return;
    }

    const exchangePromise = (async () => {
      try {
        setAuthExchangeInFlight(true);
        setAuthError(null);

        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ redirect: window.location.href }),
          cache: "no-store",
        });

        let data: { token?: string; error?: string; redirect?: string } | null = null;
        try {
          data = await response.json();
        } catch (parseError) {
          console.warn("Failed to parse session response", parseError);
        }

        if (response.status === 401) {
          if (data?.redirect) {
            window.location.href = data.redirect;
            return;
          }
          throw new Error(typeof data?.error === "string" ? data.error : "Portal session required");
        }

        if (!response.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "Portal sign-in failed");
        }

        const token = data?.token;
        if (typeof token !== "string" || !token) {
          throw new Error("Portal session did not return a token");
        }

        await signInWithCustomToken(auth, token);
        setAuthError(null);
      } catch (error) {
        console.error("Portal sign-in failed", error);
        const message = (error as Error).message || "Portal sign-in failed";
        setAuthError(message);
        pushToast({ type: "error", message });
      } finally {
        setAuthExchangeInFlight(false);
        portalSignInPromiseRef.current = null;
      }
    })();

    portalSignInPromiseRef.current = exchangePromise;
    await exchangePromise;
  }, [portalSignInPromiseRef, pushToast]);

  const requestPortalLogout = useCallback(async (redirectOverride?: string) => {
    if (typeof window === "undefined") {
      return false;
    }

    try {
      const response = await fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect: redirectOverride ?? window.location.href }),
        cache: "no-store",
      });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (typeof data?.redirect === "string" && data.redirect.length) {
        window.location.href = data.redirect;
        return true;
      }
    } catch (error) {
      console.error("Portal logout request failed", error);
    }

    return false;
  }, []);

  useEffect(() => {
    let active = true;
    const auth = getFirebaseAuth();

    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (!active) {
        return;
      }

      if (firebaseUser) {
        let effectiveEmail = firebaseUser.email ?? null;
        let effectiveDisplayName = firebaseUser.displayName ?? null;
        let portalClaims: Record<string, unknown> = {};

        const hydrateClaims = async (forceRefresh: boolean) => {
          try {
            const result = await firebaseUser.getIdTokenResult(forceRefresh);
            portalClaims = result.claims as Record<string, unknown>;
            const claimEmail = typeof portalClaims.portalEmail === "string" ? portalClaims.portalEmail : null;
            const claimDisplayName = typeof portalClaims.portalDisplayName === "string" ? portalClaims.portalDisplayName : null;
            if (!effectiveEmail && claimEmail) {
              effectiveEmail = claimEmail;
            }
            if (!effectiveDisplayName && claimDisplayName) {
              effectiveDisplayName = claimDisplayName;
            }
            return true;
          } catch (claimError) {
            console.warn("Failed to inspect ID token claims", claimError, { forceRefresh });
            portalClaims = {};
            return false;
          }
        };

        const ensureClaims = async () => {
          const emailValid = !!effectiveEmail && isEmailAllowed(effectiveEmail);
          const claimsPresent = Object.keys(portalClaims).length > 0;

          if (!emailValid || !claimsPresent) {
            const initialHydrated = await hydrateClaims(false);
            if (!emailValid && (!effectiveEmail || !isEmailAllowed(effectiveEmail))) {
              await hydrateClaims(true);
            } else if (!initialHydrated && !claimsPresent) {
              await hydrateClaims(true);
            }
          }
        };

        await ensureClaims();

        const emailAllowed = !!effectiveEmail && isEmailAllowed(effectiveEmail);
        const portalSource = typeof portalClaims.source === "string" ? portalClaims.source : null;
        const portalAppClaim = typeof portalClaims.app === "string" ? portalClaims.app : null;
        const portalTrusted = portalSource === "portal" && portalAppClaim === "proposal";

        if (!emailAllowed && !portalTrusted) {
          const message = `Access restricted to ${ALLOWED_EMAIL_DOMAINS.join(", ")} accounts`;
          setAuthError(message);
          pushToast({ type: "error", message });
          await signOut(auth);
          setAuthReady(false);
          const redirected = await requestPortalLogout();
          if (!redirected) {
            setAuthReady(true);
          }
          return;
        }

        setCurrentUserEmail(effectiveEmail ?? effectiveDisplayName ?? firebaseUser.uid);
        try {
          const token = await firebaseUser.getIdToken();
          setAuthToken(token);
        } catch (tokenError) {
          console.warn("Failed to obtain ID token", tokenError);
          setAuthToken(null);
        }
        setAuthError(null);
        setAuthReady(true);
        return;
      }

      setAuthToken(null);
      setCurrentUserEmail(null);
      setSelected(new Set());
      setDetailSlug(null);
      setAuthReady(false);

      if (typeof window === "undefined") {
        setAuthReady(true);
        return;
      }

      await beginPortalSignIn();

      if (!active) {
        return;
      }

      if (!auth.currentUser) {
        setAuthReady(true);
      }
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
      active = false;
      unsubscribe();
      window.clearInterval(refreshInterval);
    };
  }, [beginPortalSignIn, pushToast, requestPortalLogout]);

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

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setProjectSearchQuery(projectSearchInput);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [projectSearchInput]);

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
        const error: Error & { status?: number } = new Error(errorMessage);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      const items: ProposalListItem[] = Array.isArray(data?.items) ? data.items : [];
      const normalised = items.map((item) => ({
        ...item,
        viewCount: typeof item.viewCount === "number" ? item.viewCount : 0,
        downloadCount: typeof item.downloadCount === "number" ? item.downloadCount : 0,
        createdBy: item.createdBy ?? null,
      }));
      setProposals(normalised);
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return;
      }
      console.error("Failed to load proposals", error);
      const message = (error as Error).message || "Unable to load proposals";
      setListError(message);
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        setAuthError(message);
        try {
          const auth = getFirebaseAuth();
          await signOut(auth);
        } catch (signOutError) {
          console.warn("Failed to sign out after unauthorized response", signOutError);
        }
      }
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadProjectList = useCallback(async (token: string, search?: string) => {
    setProjectListLoading(true);
    try {
      const params = search && search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      const response = await fetch(`/api/antenna-projects${params}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      const items: ProjectSummary[] = Array.isArray(data?.items) ? data.items : [];
      setProjectList(items);
    } catch (error) {
      console.error("Failed to load antenna projects", error);
      pushToast({ type: "error", message: (error as Error).message || "Unable to load projects" });
      if ((error as { status?: number }).status === 401 || (error as { status?: number }).status === 403) {
        setAuthError((error as Error).message || "Authentication error");
      }
    } finally {
      setProjectListLoading(false);
    }
  }, [pushToast, setAuthError]);

  const loadProjectFloors = useCallback(async (token: string, projectId: string) => {
    setProjectFloorsLoading(true);
    try {
      const response = await fetch(`/api/antenna-projects/${projectId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      const floors: FloorSummary[] = Array.isArray(data?.floors) ? data.floors : [];
      setProjectFloors(floors);
    } catch (error) {
      console.error("Failed to load project floors", error);
      pushToast({ type: "error", message: (error as Error).message || "Unable to load floors" });
    } finally {
      setProjectFloorsLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    if (!authToken) {
      return;
    }
    const controller = new AbortController();
    loadProposals(authToken, debouncedSearch, controller.signal);
    return () => controller.abort();
  }, [authToken, debouncedSearch, loadProposals]);

  useEffect(() => {
    if (!authToken) {
      return;
    }
    void loadProjectList(authToken, projectSearchQuery);
  }, [authToken, projectSearchQuery, loadProjectList]);

  useEffect(() => {
    if (!authToken) {
      return;
    }
    if (!selectedProjectId) {
      setProjectFloors([]);
      return;
    }
    void loadProjectFloors(authToken, selectedProjectId);
  }, [authToken, selectedProjectId, loadProjectFloors]);

  const previousDetailSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (!detailSlug) {
      previousDetailSlugRef.current = null;
      setSelectedProjectId(null);
      setSelectedFloorIds(new Set());
      setPlacementNotes("");
      setPlacementDirty(false);
      return;
    }

    if (previousDetailSlugRef.current === detailSlug) {
      return;
    }

    previousDetailSlugRef.current = detailSlug;
    const placement = proposals.find((item) => item.slug === detailSlug)?.antennaPlacement ?? null;
    if (placement) {
      const safeFloors = Array.isArray(placement.floors) ? placement.floors : [];
      setSelectedProjectId(typeof placement.projectId === "string" ? placement.projectId : null);
      setSelectedFloorIds(new Set(safeFloors.map((floor) => floor.floorId)));
      setPlacementNotes(placement.notes ?? "");
    } else {
      setSelectedProjectId(null);
      setSelectedFloorIds(new Set());
      setPlacementNotes("");
    }
    setPlacementDirty(false);
  }, [detailSlug, proposals]);

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
      setIntroductionDraft("");
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

    setIntroductionDraft(typeof next.introduction === "string" ? next.introduction : "");
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
    await beginPortalSignIn();
  };

  const handleSignOut = async () => {
    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
      setAuthError(null);

      const redirected = await requestPortalLogout();
      if (!redirected) {
        pushToast({ type: "success", message: "Signed out" });
      }
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

    const payload: Record<string, unknown> = {
      introduction: introductionDraft,
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
      const nextExpiresAt = typeof result.expiresAt === "string" || result.expiresAt === null
        ? result.expiresAt
        : (payload.expiresAt as string | null | undefined) ?? null;
      const nextIntroduction = typeof result.introduction === "string" ? result.introduction : introductionDraft;

      setProposals((current) => current.map((proposal) => {
        if (proposal.slug !== detailSlug) {
          return proposal;
        }
        return {
          ...proposal,
          expiresAt: nextExpiresAt ?? null,
          isArchived: typeof result.isArchived === "boolean" ? result.isArchived : proposal.isArchived,
          introduction: nextIntroduction,
        };
      }));

      setIntroductionDraft(nextIntroduction);

      pushToast({ type: "success", message: "Proposal updated" });
      setDetailDirty(false);
    } catch (error) {
      console.error("Failed to update proposal", error);
      pushToast({ type: "error", message: (error as Error).message ?? "Update failed" });
    } finally {
      setDetailSaving(false);
    }
  };

  const handleSavePlacement = async () => {
    if (!authToken || !detailSlug) {
      return;
    }

    if (!selectedProjectId) {
      setPlacementError("Select a project to attach");
      return;
    }

    const floorIds = Array.from(selectedFloorIds);
    if (floorIds.length === 0) {
      setPlacementError("Select at least one floor");
      return;
    }

    setPlacementSaving(true);
    setPlacementError(null);
    try {
      const response = await fetch(`/api/proposals/${detailSlug}/antenna-placement`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: selectedProjectId,
          floorIds,
          notes: placementNotes.trim() ? placementNotes.trim() : undefined,
        }),
      });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      const placement: AntennaPlacementSnapshot | null = data?.antennaPlacement ?? null;
      setProposals((current) => current.map((proposal) => (proposal.slug === detailSlug ? { ...proposal, antennaPlacement: placement } : proposal)));
      setPlacementDirty(false);
      pushToast({ type: "success", message: "Provisional antenna placement updated" });
    } catch (error) {
      console.error("Failed to update antenna placement", error);
      const message = (error as Error).message || "Failed to update antenna placement";
      setPlacementError(message);
      pushToast({ type: "error", message });
    } finally {
      setPlacementSaving(false);
    }
  };

  const handleRemovePlacement = async () => {
    if (!authToken || !detailSlug) {
      return;
    }

    setPlacementSaving(true);
    setPlacementError(null);
    try {
      const response = await fetch(`/api/proposals/${detailSlug}/antenna-placement`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        throw new Error(errorMessage);
      }

      setProposals((current) => current.map((proposal) => (proposal.slug === detailSlug ? { ...proposal, antennaPlacement: null } : proposal)));
      setSelectedFloorIds(new Set());
      setSelectedProjectId(null);
      setPlacementNotes("");
      setPlacementDirty(false);
      pushToast({ type: "success", message: "Provisional antenna placement removed" });
    } catch (error) {
      console.error("Failed to remove antenna placement", error);
      const message = (error as Error).message || "Failed to remove placement";
      setPlacementError(message);
      pushToast({ type: "error", message });
    } finally {
      setPlacementSaving(false);
    }
  };

  const activeProposal = detailSlug ? proposals.find((item) => item.slug === detailSlug) : null;
  const creatorDisplayName = activeProposal?.createdBy?.displayName?.trim() || null;
  const creatorEmail = activeProposal?.createdBy?.email?.trim() || null;
  const rawPlacement = activeProposal?.antennaPlacement ?? null;
  const normalizedPlacement = useMemo(() => {
    if (!rawPlacement) {
      return null;
    }

    const floors: AntennaPlacementSnapshot["floors"] = [];

    if (Array.isArray(rawPlacement.floors)) {
      rawPlacement.floors.forEach((floor) => {
        if (!floor || typeof floor !== "object") {
          return;
        }

        const stats = floor.stats ?? {};
        const units = normalizeLengthUnit(stats.units);

        const areaSummaries = Array.isArray(stats.areaSummaries)
          ? stats.areaSummaries
              .map((entry, index) => {
                if (!entry || typeof entry !== "object") {
                  return null;
                }
                const areaEntry = entry as { id?: unknown; label?: unknown; area?: unknown };
                const id = typeof areaEntry.id === "string" && areaEntry.id.trim() ? areaEntry.id.trim() : `area-${index}`;
                const label = typeof areaEntry.label === "string" && areaEntry.label.trim()
                  ? areaEntry.label.trim()
                  : `Area ${index + 1}`;
                const area = toFiniteNumber(areaEntry.area);
                return {
                  id,
                  label,
                  area,
                };
              })
              .filter((item): item is { id: string; label: string; area: number } => Boolean(item))
          : [];

        const antennaRangeValue = (() => {
          const rawRange = (stats as { antennaRange?: unknown }).antennaRange;
          return typeof rawRange === "number" && Number.isFinite(rawRange) ? rawRange : null;
        })();

        const sanitizedAntennas: AntennaPlacementAntenna[] = Array.isArray(floor.antennas)
          ? floor.antennas.reduce<AntennaPlacementAntenna[]>((acc, antenna, index) => {
              if (!antenna || typeof antenna !== "object") {
                return acc;
              }
              const rawAntenna = antenna as Partial<AntennaPlacementAntenna>;
              const id =
                typeof rawAntenna.id === "string" && rawAntenna.id.trim()
                  ? rawAntenna.id.trim()
                  : `antenna-${index}`;
              const x = clamp(toFiniteNumber(rawAntenna.x), 0, 1);
              const y = clamp(toFiniteNumber(rawAntenna.y), 0, 1);
              const range =
                typeof rawAntenna.range === "number" && Number.isFinite(rawAntenna.range)
                  ? rawAntenna.range
                  : null;
              const power =
                typeof rawAntenna.power === "number" && Number.isFinite(rawAntenna.power)
                  ? rawAntenna.power
                  : null;

              acc.push({
                id,
                x,
                y,
                range,
                pulsing: Boolean(rawAntenna.pulsing),
                power,
              });
              return acc;
            }, [])
          : [];

        const sanitizedCoveragePolygons = Array.isArray(floor.coveragePolygons)
          ? floor.coveragePolygons
              .map((polygon, index) => {
                if (!polygon || typeof polygon !== "object") {
                  return null;
                }
                const rawPolygon = polygon as AntennaPlacementCoveragePolygon;
                const points = Array.isArray(rawPolygon.points)
                  ? rawPolygon.points
                      .map((point) => {
                        if (!point || typeof point !== "object") {
                          return null;
                        }
                        const candidate = point as { x?: unknown; y?: unknown };
                        const x = clamp(toFiniteNumber(candidate.x), 0, 1);
                        const y = clamp(toFiniteNumber(candidate.y), 0, 1);
                        return { x, y };
                      })
                      .filter((point): point is { x: number; y: number } => point !== null)
                  : [];

                if (points.length < 3) {
                  return null;
                }

                const id = typeof rawPolygon.id === "string" && rawPolygon.id.trim() ? rawPolygon.id.trim() : `coverage-${index}`;
                return { id, points } satisfies AntennaPlacementCoveragePolygon;
              })
              .filter((polygon): polygon is AntennaPlacementCoveragePolygon => Boolean(polygon))
          : [];

        const rawBounds = floor.coverageBounds as { minX?: unknown; minY?: unknown; maxX?: unknown; maxY?: unknown } | null | undefined;
        let coverageBounds: AntennaPlacementFloorSnapshot["coverageBounds"] = null;

        if (rawBounds && typeof rawBounds === "object") {
          const minX = clamp(toFiniteNumber(rawBounds.minX, Number.NaN), 0, 1);
          const minY = clamp(toFiniteNumber(rawBounds.minY, Number.NaN), 0, 1);
          const maxX = clamp(toFiniteNumber(rawBounds.maxX, Number.NaN), 0, 1);
          const maxY = clamp(toFiniteNumber(rawBounds.maxY, Number.NaN), 0, 1);
          if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY) && maxX > minX && maxY > minY) {
            coverageBounds = { minX, minY, maxX, maxY };
          }
        }

        if (!coverageBounds && sanitizedCoveragePolygons.length) {
          const fallbackBounds = computeCoverageBoundsFromPolygons(sanitizedCoveragePolygons);
          if (fallbackBounds) {
            coverageBounds = fallbackBounds;
          }
        }

        floors.push({
          ...floor,
          antennas: sanitizedAntennas,
          coveragePolygons: sanitizedCoveragePolygons,
          coverageBounds,
          stats: {
            antennaCount: toNonNegativeInteger((stats as { antennaCount?: unknown }).antennaCount),
            pulsingAntennaCount: toNonNegativeInteger((stats as { pulsingAntennaCount?: unknown }).pulsingAntennaCount),
            totalArea: toFiniteNumber((stats as { totalArea?: unknown }).totalArea),
            areaSummaries,
            units,
            antennaRange: antennaRangeValue,
          },
        });
      });
    }

    const derivedTotals = floors.reduce(
      (acc, floor) => {
        acc.antennaCount += floor.stats.antennaCount;
        acc.pulsingCount += floor.stats.pulsingAntennaCount;
        acc.totalArea += floor.stats.totalArea;
        return acc;
      },
      { antennaCount: 0, pulsingCount: 0, totalArea: 0 },
    );

    const summaryUnits = normalizeLengthUnit(
      (rawPlacement.summary?.units ?? floors[0]?.stats.units ?? "meters") as LengthUnit,
    );

    const summary = {
      floorCount: toNonNegativeInteger(rawPlacement.summary?.floorCount, floors.length),
      antennaCount: toNonNegativeInteger(rawPlacement.summary?.antennaCount, derivedTotals.antennaCount),
      pulsingAntennaCount: toNonNegativeInteger(
        rawPlacement.summary?.pulsingAntennaCount,
        derivedTotals.pulsingCount,
      ),
      totalArea: toFiniteNumber(rawPlacement.summary?.totalArea, derivedTotals.totalArea),
      units: summaryUnits,
    };

    return {
      ...rawPlacement,
      floors,
      summary,
    } satisfies AntennaPlacementSnapshot;
  }, [rawPlacement]);

  const placementSummary = normalizedPlacement?.summary ?? null;
  const placementFloors = normalizedPlacement?.floors ?? [];
  const placementAreaLabel = placementSummary
    ? `${placementSummary.totalArea.toFixed(1)} ${UNIT_AREA_SUFFIX[placementSummary.units]}`
    : "—";
  const selectedProject = selectedProjectId
    ? projectList.find((project) => project.id === selectedProjectId) ?? null
    : null;
  const selectedFloorsCount = selectedFloorIds.size;
  const handleHoverEvents = useCallback(
    async (slug: string, type: "open" | "download") => {
      setHoverTarget({ slug, type });
      setHoverEvents(null);
      setHoverEventsError(null);
      setHoverEventsLoading(true);
      try {
        const params = new URLSearchParams({ type, limit: "20" });
        const response = await fetch(`/api/proposals/${encodeURIComponent(slug)}/events?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          const message = await readErrorMessage(response);
          throw new Error(message);
        }
        const data = await response.json();
        const items: ProposalEvent[] = Array.isArray(data?.items) ? data.items : [];
        setHoverEvents(items);
      } catch (error) {
        console.error("Failed to load proposal events", error);
        setHoverEventsError((error as Error).message || "Unable to load events");
        setHoverEvents(null);
      } finally {
        setHoverEventsLoading(false);
      }
    },
    [],
  );

  const handleResetActivity = useCallback(async () => {
    if (!authToken || !detailSlug || activityResetting) {
      return;
    }

    const confirmed = typeof window === "undefined"
      ? true
      : window.confirm(
          "Clear all recorded opens and downloads for this proposal? This also removes the recent activity list.",
        );

    if (!confirmed) {
      return;
    }

    setActivityResetting(true);
    try {
      const response = await fetch(`/api/proposals/${detailSlug}/events`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        throw new Error(errorMessage);
      }

      setProposals((current) => current.map((proposal) => (
        proposal.slug === detailSlug
          ? { ...proposal, viewCount: 0, downloadCount: 0 }
          : proposal
      )));
      setHoverTarget((current) => (current && current.slug === detailSlug ? null : current));
      setHoverEvents(null);
      setHoverEventsError(null);

      pushToast({ type: "success", message: "Opens and downloads cleared" });
    } catch (error) {
      console.error("Failed to reset viewer activity", error);
      pushToast({ type: "error", message: (error as Error).message || "Unable to clear counts" });
    } finally {
      setActivityResetting(false);
    }
  }, [activityResetting, authToken, detailSlug, pushToast]);
  const renderAuthGate = () => {
    if (!authReady) {
      return (
        <div className="flex h-screen items-center justify-center">
          <p className="text-lg font-semibold">{authExchangeInFlight ? "Signing you in via the UCtel portal…" : "Checking authentication…"}</p>
        </div>
      );
    }

    if (!authToken) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-6 bg-[var(--background)] px-6 text-center text-[var(--foreground)]">
          <Image
            src="/images/uctel_logo.png"
            alt="UCtel logo"
            width={200}
            height={60}
            priority
            className="h-14 w-auto"
          />
          <div className="max-w-md space-y-2">
            <h1 className="text-2xl font-semibold text-[var(--uctel-navy)]">UCtel Proposal Admin</h1>
            <p className="text-base text-[var(--muted-foreground)]">
              Continue via the UCtel portal to manage proposals, update introductions, and export PDFs.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignIn}
            disabled={authExchangeInFlight}
            className="uctel-primary rounded-md px-6 py-3 text-base font-semibold shadow transition focus:outline-none focus:ring-2 focus:ring-[rgba(28,139,157,0.35)] focus:ring-offset-2 focus:ring-offset-[var(--background)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {authExchangeInFlight ? "Signing in…" : "Continue via UCtel Portal"}
          </button>
          {authError && (
            <p className="text-sm text-[#d8613b]">{authError}</p>
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
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex flex-col gap-4 border-b border-transparent bg-[var(--uctel-navy)] px-6 py-5 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Image
            src="/images/uctel_logo.png"
            alt="UCtel logo"
            width={160}
            height={48}
            priority
            className="h-10 w-auto"
          />
          <div>
            <h1 className="text-xl font-semibold text-white">Proposal management</h1>
            <p className="text-sm text-white/75">Search, review, and maintain saved proposals.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white/90">
            {currentUserEmail ?? "UCtel admin"}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-md border border-white/60 bg-white/0 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[var(--uctel-navy)]"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="pointer-events-none fixed top-4 right-4 z-50 flex max-w-sm flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-md border px-4 py-3 shadow transition ${toast.type === "success" ? "border-[#b7e3ea] bg-[#e9f6f8] text-[#1c8b9d]" : "border-[#f3c4aa] bg-[#fef0e6] text-[#d8613b]"}`}
          >
            <div className="flex items-start gap-3">
              <span className="flex-1 text-sm">{toast.message}</span>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismissToast(toast.id)}
                className="rounded-full p-1 text-xs text-current/80 transition hover:bg-white/40 focus:outline-none focus:ring-2 focus:ring-current/30"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6">
        <section className="flex flex-col gap-4 rounded-xl uctel-surface p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 items-center gap-3">
              <input
                type="search"
                placeholder="Search by customer, quote number, or keyword"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="w-full rounded-lg border border-[#cad7df] px-3 py-2 text-sm text-[var(--foreground)] shadow-sm focus:border-[var(--uctel-teal)] focus:outline-none focus:ring-2 focus:ring-[rgba(28,139,157,0.25)]"
              />
              <button
                type="button"
                onClick={() => loadProposals(authToken!, searchInput)}
                className="hidden rounded-lg border border-[#9bbccc] px-3 py-2 text-sm font-medium text-[var(--uctel-navy)] transition hover:bg-[#f0f7f9] lg:inline-flex"
              >
                Refresh
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleBulkAction("archive", authToken!, Array.from(selected), loadProposals, debouncedSearch)}
                disabled={!visibleSelectionCount || bulkLoading}
                className="uctel-outlined rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                Archive
              </button>
              <button
                type="button"
                onClick={() => handleBulkAction("unarchive", authToken!, Array.from(selected), loadProposals, debouncedSearch)}
                disabled={!visibleSelectionCount || bulkLoading}
                className="uctel-outlined rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                Unarchive
              </button>
              <button
                type="button"
                onClick={() => handleBulkAction("set-expiry", authToken!, Array.from(selected), loadProposals, debouncedSearch)}
                disabled={!visibleSelectionCount || bulkLoading}
                className="uctel-outlined rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                Set expiry
              </button>
              <button
                type="button"
                onClick={() => handleBulkAction("clear-expiry", authToken!, Array.from(selected), loadProposals, debouncedSearch)}
                disabled={!visibleSelectionCount || bulkLoading}
                className="uctel-outlined rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear expiry
              </button>
              <button
                type="button"
                onClick={() => handleBulkAction("delete", authToken!, Array.from(selected), loadProposals, debouncedSearch)}
                disabled={!visibleSelectionCount || bulkLoading}
                className="rounded-lg border border-[#f3c4aa] px-3 py-2 text-sm font-medium text-[#d8613b] transition hover:bg-[#fef0e6] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white shadow-sm">
            <table className="min-w-full divide-y divide-[var(--border-subtle)] text-sm">
              <thead className="uctel-table-header text-left">
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
                  <th className="px-3 py-2 font-semibold">Owner</th>
                  <th className="px-3 py-2 font-semibold">Expiry</th>
                  <th className="px-3 py-2 font-semibold">Updated</th>
                  <th className="px-3 py-2 font-semibold text-center">Opens</th>
                  <th className="px-3 py-2 font-semibold text-center">Downloads</th>
                  <th className="px-3 py-2 font-semibold text-center">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {proposals.map((proposal) => {
                  const isSelected = selected.has(proposal.slug);
                  const isArchived = Boolean(proposal.isArchived);
                  const isActive = detailSlug === proposal.slug;
                  return (
                    <Fragment key={proposal.slug}>
                      <tr
                        className={`uctel-table-row cursor-pointer bg-white ${isArchived ? "opacity-70" : ""}`}
                        data-selected={isSelected ? "true" : "false"}
                        data-active={isActive ? "true" : "false"}
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
                          <span className="font-medium text-[var(--foreground)]">{proposal.metadata?.customerName ?? "—"}</span>
                          <a
                            href={`/${proposal.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-[var(--uctel-teal)] hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {proposal.slug}
                          </a>
                          {isArchived && <span className="mt-1 inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium uppercase uctel-badge-accent">Archived</span>}
                        </div>
                      </td>
                        <td className="px-3 py-3 text-[var(--muted-foreground)]">{proposal.metadata?.solutionType ?? "—"}</td>
                      <td className="px-3 py-3 text-[var(--muted-foreground)]">{typeof proposal.metadata?.numberOfNetworks === "number" ? proposal.metadata.numberOfNetworks : "—"}</td>
                      <td className="px-3 py-3 text-[var(--muted-foreground)]">{formatCurrency(proposal.metadata?.totalPrice ?? null)}</td>
                      <td className="px-3 py-3 text-[var(--muted-foreground)]">
                        {(() => {
                          const createdBy = proposal.createdBy;
                          if (!createdBy) {
                            return "—";
                          }
                          const preferred = (createdBy.firstName && createdBy.firstName.trim())
                            || (createdBy.displayName && createdBy.displayName.trim())
                            || (createdBy.email && createdBy.email.trim());
                          return preferred || "—";
                        })()}
                      </td>
                        <td className="px-3 py-3 text-[var(--muted-foreground)]">{formatExpiry(proposal.expiresAt)}</td>
                        <td className="px-3 py-3 text-[var(--muted-foreground)]">{formatDateTime(proposal.updatedAt)}</td>
                        <td
                        className="px-3 py-3 text-center text-[var(--muted-foreground)]"
                        onMouseEnter={(event) => {
                          event.stopPropagation();
                          void handleHoverEvents(proposal.slug, "open");
                        }}
                        onMouseLeave={(event) => {
                          event.stopPropagation();
                          setHoverTarget((current) =>
                            current && current.slug === proposal.slug && current.type === "open" ? null : current,
                          );
                          setHoverEvents(null);
                          setHoverEventsError(null);
                        }}
                      >
                        {proposal.viewCount ?? 0}
                      </td>
                        <td
                        className="px-3 py-3 text-center text-[var(--muted-foreground)]"
                        onMouseEnter={(event) => {
                          event.stopPropagation();
                          void handleHoverEvents(proposal.slug, "download");
                        }}
                        onMouseLeave={(event) => {
                          event.stopPropagation();
                          setHoverTarget((current) =>
                            current && current.slug === proposal.slug && current.type === "download" ? null : current,
                          );
                          setHoverEvents(null);
                          setHoverEventsError(null);
                        }}
                      >
                        {proposal.downloadCount ?? 0}
                      </td>
                        <td className="px-3 py-3 text-center">
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-full border border-[#cad7df] bg-white p-2 text-[var(--muted-foreground)] transition hover:bg-[#f3fbfd]"
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

                      {hoverTarget && hoverTarget.slug === proposal.slug && (
                        <tr className="bg-[var(--table-header-bg)]/40">
                          <td colSpan={11} className="px-3 py-2">
                            <div className="rounded-lg border border-[var(--border-subtle)] bg-white p-3 text-xs text-[var(--muted-foreground)] shadow-sm">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="font-semibold text-[var(--uctel-navy)]">
                                  {hoverTarget.type === "open" ? "Recent opens" : "Recent downloads"}
                                </span>
                                {hoverEventsLoading && (
                                  <span className="text-[10px] uppercase tracking-wide">Loading…</span>
                                )}
                              </div>
                              {hoverEventsError && (
                                <div className="text-[#d8613b]">{hoverEventsError}</div>
                              )}
                              {!hoverEventsError && !hoverEventsLoading && (!hoverEvents || hoverEvents.length === 0) && (
                                <div>No recent activity recorded.</div>
                              )}
                              {!hoverEventsError && hoverEvents && hoverEvents.length > 0 && (
                                <ul className="space-y-1">
                                  {hoverEvents.slice(0, 10).map((event) => (
                                    <li key={event.id} className="flex items-baseline justify-between gap-4">
                                      <div className="flex flex-col">
                                        <span className="font-medium text-[var(--foreground)]">
                                          {event.email ?? "Unknown email"}
                                        </span>
                                      </div>
                                      <span className="whitespace-nowrap text-[11px] text-[var(--muted-foreground)]">
                                        {formatEventDateTime(event.createdAt)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>

            {!listLoading && !proposals.length && (
              <div className="p-6 text-center text-sm text-[var(--muted-foreground)]">No proposals found. Adjust your filters and try again.</div>
            )}
            {listLoading && (
              <div className="p-6 text-center text-sm text-[var(--muted-foreground)]">Loading proposals…</div>
            )}
            {listError && (
              <div className="p-6 text-center text-sm text-[#d8613b]">{listError}</div>
            )}
          </div>

          <div className="flex items-center justify-between text-sm text-[var(--muted-foreground)]">
            <span>{proposals.length} proposals</span>
            <span>{visibleSelectionCount} selected</span>
          </div>
        </section>

        <section className="rounded-xl uctel-surface p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold uctel-section-title">Viewer activity</h2>
              <p className="text-sm text-[var(--muted-foreground)]">Live totals from the public proposal link. Resetting also removes the underlying activity log.</p>
            </div>
            <button
              type="button"
              onClick={handleResetActivity}
              disabled={!activeProposal || activityResetting}
              className="rounded-lg border border-[#f3c4aa] px-4 py-2 text-sm font-medium text-[#d8613b] transition hover:bg-[#fef0e6] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {activityResetting ? "Clearing…" : "Clear counts"}
            </button>
          </div>
          {activeProposal ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-[#cad7df] bg-white/70 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Total opens</div>
                <div className="text-3xl font-semibold text-[var(--uctel-navy)]">{activeProposal.viewCount ?? 0}</div>
                <p className="text-xs text-[var(--muted-foreground)]">Incremented whenever a viewer submits their email.</p>
              </div>
              <div className="rounded-lg border border-[#cad7df] bg-white/70 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Total downloads</div>
                <div className="text-3xl font-semibold text-[var(--uctel-navy)]">{activeProposal.downloadCount ?? 0}</div>
                <p className="text-xs text-[var(--muted-foreground)]">Captured when a customer downloads the PDF.</p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted-foreground)]">Select a proposal to review and reset its viewer activity.</p>
          )}
        </section>

        <section className="grid gap-5 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-xl uctel-surface p-5">
            <h2 className="mb-3 text-base font-semibold uctel-section-title">Proposal introduction</h2>
            {activeProposal ? (
              <div className="flex flex-col gap-3">
                <textarea
                  value={introductionDraft}
                  onChange={(event) => {
                    setIntroductionDraft(event.target.value);
                    setDetailDirty(true);
                  }}
                  rows={8}
                  className="rounded-lg border border-[#cad7df] px-3 py-3 text-sm text-[var(--foreground)] focus:border-[var(--uctel-teal)] focus:outline-none focus:ring-2 focus:ring-[rgba(28,139,157,0.25)]"
                  placeholder="Appears in the Introduction section of the proposal"
                />
                <span className="text-xs text-[var(--muted-foreground)]">
                  Basic HTML (e.g. &lt;strong&gt;) is supported. Limited to {INTRODUCTION_MAX_LENGTH} characters.
                </span>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">Select a proposal to view and edit the introduction.</p>
            )}
          </div>

          <div className="rounded-xl uctel-surface p-5">
            <h2 className="mb-3 text-base font-semibold uctel-section-title">Creator & expiry</h2>
            {activeProposal ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveDetails();
                }}
              >
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--muted-foreground)]">Creator</span>
                  <div className="rounded-lg border border-[#e0d7d1] bg-[#f9f3ee] px-3 py-2 text-sm text-[var(--foreground)]">
                    {creatorDisplayName || creatorEmail || "—"}
                    {creatorDisplayName && creatorEmail && creatorDisplayName !== creatorEmail && (
                      <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">{creatorEmail}</span>
                    )}
                  </div>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--muted-foreground)]">Expiry date (optional)</span>
                  <input
                    type="date"
                    value={expiryDraft}
                    onChange={(event) => {
                      setExpiryDraft(event.target.value);
                      setDetailDirty(true);
                    }}
                    className="rounded-lg border border-[#cad7df] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--uctel-teal)] focus:outline-none focus:ring-2 focus:ring-[rgba(28,139,157,0.25)]"
                  />
                </label>

                <button
                  type="submit"
                  disabled={detailSaving || !detailDirty}
                  className="uctel-primary mt-2 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium shadow transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {detailSaving ? "Saving…" : "Save changes"}
                </button>
              </form>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">Choose a proposal to view creator and expiry details.</p>
            )}
          </div>
        </section>

        <section className="rounded-xl uctel-surface p-5">
          <h2 className="mb-3 text-base font-semibold uctel-section-title">Provisional Antenna Placement</h2>
          {activeProposal ? (
            <div className="flex flex-col gap-5">
              <div className="rounded-lg border border-[#cad7df] bg-white/60 p-4 text-sm text-[var(--foreground)]">
                {normalizedPlacement ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--uctel-navy)]">{normalizedPlacement.projectName}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">Project ID: {normalizedPlacement.projectId}</p>
                      </div>
                      <div className="text-xs text-[var(--muted-foreground)]">
                        Generated {formatDateTime(normalizedPlacement.generatedAt)}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-md bg-[var(--background)] px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Floors</div>
                        <div className="text-base font-semibold text-[var(--uctel-navy)]">{placementSummary?.floorCount ?? 0}</div>
                      </div>
                      <div className="rounded-md bg-[var(--background)] px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Antennas</div>
                        <div className="text-base font-semibold text-[var(--uctel-navy)]">
                          {placementSummary?.antennaCount ?? 0}
                          {(placementSummary?.pulsingAntennaCount ?? 0) > 0 && (
                            <span className="ml-2 text-xs font-medium text-[#d8613b]">
                              {placementSummary?.pulsingAntennaCount} pulsing
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="rounded-md bg-[var(--background)] px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Measured area</div>
                        <div className="text-base font-semibold text-[var(--uctel-navy)]">{placementAreaLabel}</div>
                      </div>
                    </div>
                    <ul className="space-y-1 text-sm text-[var(--muted-foreground)]">
                      {placementFloors.map((floor) => (
                        <li key={floor.floorId}>
                          <span className="font-medium text-[var(--uctel-navy)]">{floor.floorName}</span>
                          {" – "}
                          {floor.stats.antennaCount} antenna{floor.stats.antennaCount === 1 ? "" : "s"}, {floor.stats.totalArea.toFixed(1)} {UNIT_AREA_SUFFIX[floor.stats.units]}
                          </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={handleRemovePlacement}
                        disabled={placementSaving}
                        className="rounded-lg border border-[#f3c4aa] px-3 py-1.5 text-xs font-medium text-[#d8613b] transition hover:bg-[#fef0e6] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Remove section
                      </button>
                      {normalizedPlacement.notes && (
                        <span className="rounded-full bg-[#f0f7f9] px-3 py-1 text-xs text-[var(--uctel-navy)]">
                          {normalizedPlacement.notes}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted-foreground)]">No antenna placement attached yet.</p>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-[2fr_3fr]">
                <div className="space-y-3">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-[var(--muted-foreground)]">Search projects</span>
                    <div className="flex gap-2">
                      <input
                        type="search"
                        value={projectSearchInput}
                        onChange={(event) => setProjectSearchInput(event.target.value)}
                        placeholder="Project name or ID"
                        className="flex-1 rounded-lg border border-[#cad7df] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--uctel-teal)] focus:outline-none focus:ring-2 focus:ring-[rgba(28,139,157,0.25)]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (authToken) {
                            void loadProjectList(authToken, projectSearchInput);
                          }
                        }}
                        className="rounded-lg border border-[#cad7df] px-3 py-2 text-sm font-medium text-[var(--uctel-navy)] transition hover:bg-[#f0f7f9]"
                      >
                        Refresh
                      </button>
                    </div>
                  </label>

                  <div className="max-h-56 overflow-y-auto rounded-lg border border-[#cad7df] bg-white/70">
                    {projectListLoading ? (
                      <div className="p-3 text-sm text-[var(--muted-foreground)]">Loading projects…</div>
                    ) : projectList.length ? (
                      <ul className="divide-y divide-[#e4edf1]">
                        {projectList.map((project) => {
                          const isSelected = project.id === selectedProjectId;
                          return (
                            <li key={project.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setPlacementError(null);
                                  setSelectedProjectId(project.id);
                                  if (normalizedPlacement?.projectId === project.id) {
                                    setSelectedFloorIds(new Set(placementFloors.map((floor) => floor.floorId)));
                                    setPlacementNotes(normalizedPlacement.notes ?? "");
                                    setPlacementDirty(false);
                                  } else {
                                    setSelectedFloorIds(new Set());
                                    setPlacementNotes("");
                                    setPlacementDirty(true);
                                  }
                                }}
                                className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition ${
                                  isSelected ? "bg-[#f0f7f9]" : "hover:bg-[#f6fbfd]"
                                }`}
                              >
                                <div>
                                  <p className="font-medium text-[var(--uctel-navy)]">{project.name}</p>
                                  <p className="text-xs text-[var(--muted-foreground)]">{project.floorCount} floor{project.floorCount === 1 ? "" : "s"}</p>
                                </div>
                                {isSelected && (
                                  <span className="rounded-full bg-[var(--uctel-teal)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--uctel-teal)]">Selected</span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className="p-3 text-sm text-[var(--muted-foreground)]">No projects found.</div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--uctel-navy)]">Select floors</span>
                    {selectedProject && (
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {selectedFloorsCount} selected · {projectFloors.length} available
                      </span>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-[#cad7df] bg-white/70">
                    {!selectedProjectId ? (
                      <div className="p-3 text-sm text-[var(--muted-foreground)]">Select a project to see its floors.</div>
                    ) : projectFloorsLoading ? (
                      <div className="p-3 text-sm text-[var(--muted-foreground)]">Loading floors…</div>
                    ) : projectFloors.length ? (
                      <ul className="divide-y divide-[#e4edf1]">
                        {projectFloors.map((floor) => {
                          const checked = selectedFloorIds.has(floor.floorId);
                          return (
                            <li key={floor.floorId}>
                              <label className="flex cursor-pointer items-start justify-between gap-3 px-3 py-2">
                                <div className="flex items-start gap-3">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      setPlacementError(null);
                                      setSelectedFloorIds((current) => {
                                        const next = new Set(current);
                                        if (next.has(floor.floorId)) {
                                          next.delete(floor.floorId);
                                        } else {
                                          next.add(floor.floorId);
                                        }
                                        return next;
                                      });
                                      setPlacementDirty(true);
                                    }}
                                  />
                                  <div>
                                    <p className="font-medium text-[var(--uctel-navy)]">{floor.name}</p>
                                    <p className="text-xs text-[var(--muted-foreground)]">
                                      {floor.antennaCount} antenna{floor.antennaCount === 1 ? "" : "s"} · {floor.totalArea.toFixed(1)} {floor.units === "feet" ? "ft²" : "m²"}
                                    </p>
                                  </div>
                                </div>
                                {checked && (
                                  <span className="rounded-full bg-[#f0f7f9] px-2 py-0.5 text-[10px] font-semibold text-[var(--uctel-teal)]">Included</span>
                                )}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className="p-3 text-sm text-[var(--muted-foreground)]">No floors available for this project.</div>
                    )}
                  </div>

                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-[var(--muted-foreground)]">Notes (optional)</span>
                    <textarea
                      value={placementNotes}
                      onChange={(event) => {
                        setPlacementNotes(event.target.value);
                        setPlacementDirty(true);
                      }}
                      rows={3}
                      className="rounded-lg border border-[#cad7df] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--uctel-teal)] focus:outline-none focus:ring-2 focus:ring-[rgba(28,139,157,0.25)]"
                      placeholder="Internal note for this attachment"
                    />
                  </label>

                  {placementError && (
                    <div className="rounded-md border border-[#f3c4aa] bg-[#fef0e6] px-3 py-2 text-sm text-[#d8613b]">{placementError}</div>
                  )}

                  <div className="flex flex-wrap gap-3 pt-1">
                    <button
                      type="button"
                      onClick={handleSavePlacement}
                      disabled={placementSaving || !selectedProjectId || selectedFloorIds.size === 0}
                      className="uctel-primary inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium shadow transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {placementSaving ? "Saving…" : "Attach to proposal"}
                    </button>
                    {placementDirty && (
                      <span className="rounded-full bg-[#fef0e6] px-3 py-1 text-xs font-medium text-[#d8613b]">Unsaved changes</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">Select a proposal to manage provisional antenna placement.</p>
          )}
        </section>
      </main>
    </div>
  );
}
