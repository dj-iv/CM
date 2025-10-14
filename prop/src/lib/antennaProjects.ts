import { Timestamp } from "firebase-admin/firestore";
import type { DocumentData, DocumentSnapshot, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getFloorplanFirestore } from "@/lib/firebaseAdmin";
import {
  AntennaPlacementAntenna,
  AntennaPlacementAreaSummary,
  AntennaPlacementFloorSnapshot,
  AntennaPlacementFloorStats,
  AntennaPlacementSnapshot,
  AntennaPlacementSummary,
  LengthUnit,
} from "@/types/antennaPlacement";

interface Point {
  x: number;
  y: number;
}

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
};

const toPointArray = (input: unknown): Point[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const maybePoint = entry as { x?: unknown; y?: unknown };
      const x = typeof maybePoint.x === "number" ? maybePoint.x : Number.NaN;
      const y = typeof maybePoint.y === "number" ? maybePoint.y : Number.NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      return { x, y } as Point;
    })
    .filter((point): point is Point => point !== null);
};

const extractPolygonSets = (value: unknown): Point[][] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: Point[][] = [];

  for (const entry of value) {
    if (!entry) {
      continue;
    }
    if (Array.isArray(entry)) {
      const points = toPointArray(entry);
      if (points.length >= 3) {
        result.push(points);
      }
      continue;
    }
    if (typeof entry === "object" && Array.isArray((entry as { points?: unknown }).points)) {
      const points = toPointArray((entry as { points: unknown }).points);
      if (points.length >= 3) {
        result.push(points);
      }
    }
  }

  return result;
};

interface SelectionEntry {
  id?: string;
  value?: number;
  label?: string;
}

interface StoredAntenna {
  id?: string;
  position?: Point | null;
  range?: number | null;
  power?: number | null;
  pulsing?: boolean;
}

interface StoredCanvasState {
  antennas?: StoredAntenna[];
  selections?: SelectionEntry[];
  areas?: Array<{ id?: string; area?: number; points?: Point[] } | Point[]>;
  manualRegions?: Point[][];
  savedAreas?: Point[][];
  scale?: number | null;
  scaleUnit?: LengthUnit | string | null;
  antennaRange?: number | null;
  pulsingAntennaIds?: string[];
  canvasWidth?: number | null;
  canvasHeight?: number | null;
  originalImageWidth?: number | null;
  originalImageHeight?: number | null;
}

interface FloorMetadata {
  imageUrl?: string;
  thumbnailUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  storagePath?: string;
}

interface StoredFloorDoc {
  name?: string;
  orderIndex?: number;
  updatedAt?: Timestamp;
  metadata?: FloorMetadata;
  canvasState?: StoredCanvasState;
  units?: LengthUnit | string | null;
}

interface StoredProjectDoc {
  name?: string;
  updatedAt?: Timestamp;
}

interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string | null;
  floorCount: number;
  thumbnailUrl?: string;
}

interface FloorSummary {
  floorId: string;
  name: string;
  orderIndex: number;
  updatedAt: string | null;
  thumbnailUrl?: string;
  antennaCount: number;
  pulsingAntennaCount: number;
  totalArea: number;
  units: LengthUnit;
}

const toDate = (value: unknown): Date | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (value instanceof Timestamp) {
    try {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    } catch (error) {
      console.warn("antennaProjects: failed to convert timestamp", error);
      return null;
    }
  }
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    } catch (error) {
      console.warn("antennaProjects: failed to call toDate()", error);
      return null;
    }
  }
  return null;
};

const normaliseUnit = (unit: LengthUnit | string | null | undefined): LengthUnit => {
  switch ((unit ?? "meters").toString()) {
    case "cm":
      return "cm";
    case "mm":
      return "mm";
    case "feet":
    case "ft":
      return "feet";
    case "meter":
    case "metre":
    case "metres":
    case "m":
    case "meters":
    default:
      return "meters";
  }
};

const convertAreaToSquareMeters = (area: number, unit: LengthUnit): number => {
  if (!Number.isFinite(area)) {
    return 0;
  }
  switch (unit) {
    case "cm":
      return area / 10_000;
    case "mm":
      return area / 1_000_000;
    case "feet":
      return area * 0.09290304;
    case "meters":
    default:
      return area;
  }
};

const convertAreaFromSquareMeters = (areaSqMeters: number, target: LengthUnit): number => {
  switch (target) {
    case "cm":
      return areaSqMeters * 10_000;
    case "mm":
      return areaSqMeters * 1_000_000;
    case "feet":
      return areaSqMeters / 0.09290304;
    case "meters":
    default:
      return areaSqMeters;
  }
};

const computeFloorStatistics = (canvasState: StoredCanvasState): AntennaPlacementFloorStats => {
  const antennas = Array.isArray(canvasState.antennas) ? canvasState.antennas : [];
  const antennaCount = antennas.length;

  const antennaRanges = antennas
    .map((antenna) => (typeof antenna?.range === "number" && Number.isFinite(antenna.range) ? antenna.range : null))
    .filter((value): value is number => value !== null && value > 0);

  let antennaRange: number | null = null;
  if (typeof canvasState.antennaRange === "number" && Number.isFinite(canvasState.antennaRange)) {
    antennaRange = canvasState.antennaRange;
  } else if (antennaRanges.length > 0) {
    const total = antennaRanges.reduce((sum, value) => sum + value, 0);
    antennaRange = total / antennaRanges.length;
  }

  const selectionEntries = Array.isArray(canvasState.selections)
    ? canvasState.selections.filter((entry): entry is SelectionEntry => entry !== null && typeof entry === "object")
    : [];

  const selectionAreas: AntennaPlacementAreaSummary[] = selectionEntries
    .filter((entry) => typeof entry.value === "number" && Number.isFinite(entry.value))
    .map((entry, idx) => {
      const value = entry.value ?? 0;
      const label = entry.label && entry.label.trim() ? entry.label.trim() : `Area ${idx + 1}`;
      return {
        id: entry.id || `selection-${idx}`,
        label,
        area: value,
      };
    });

  let areas = selectionAreas;
  if (!areas.length && Array.isArray(canvasState.areas)) {
    const fallbackAreas = canvasState.areas
      .map((entry, idx) => {
        if (!entry || Array.isArray(entry) || typeof entry !== "object") {
          return null;
        }
        const record = entry as { id?: string; area?: number };
        if (typeof record.area !== "number" || !Number.isFinite(record.area)) {
          return null;
        }
        return {
          id: record.id || `area-${idx}`,
          label: `Area ${idx + 1}`,
          area: record.area ?? 0,
        } satisfies AntennaPlacementAreaSummary;
      })
      .filter((item): item is AntennaPlacementAreaSummary => item !== null);

    if (fallbackAreas.length) {
      areas = fallbackAreas;
    }
  }

  const units = normaliseUnit(canvasState.scaleUnit);
  const totalArea = areas.reduce((sum, item) => sum + (item.area || 0), 0);
  const positiveAreas = areas.filter((item) => item.area > 0);
  const areaSummaries = positiveAreas.length ? positiveAreas : areas;

  const pulsingSet = new Set(canvasState.pulsingAntennaIds || []);
  const pulsingAntennaCount = antennas.filter((antenna) => {
    if (!antenna) {
      return false;
    }
    if (antenna.pulsing) {
      return true;
    }
    return antenna.id ? pulsingSet.has(antenna.id) : false;
  }).length;

  return {
    antennaCount,
    pulsingAntennaCount,
    totalArea,
    areaSummaries: areaSummaries.map((item) => ({ ...item })),
    antennaRange,
    units,
  };
};

const buildAntennaSnapshot = (
  floorId: string,
  floorName: string,
  orderIndex: number,
  metadata: FloorMetadata,
  canvasState: StoredCanvasState,
): AntennaPlacementFloorSnapshot => {
  const stats = computeFloorStatistics(canvasState);
  const { antennas = [] } = canvasState;
  const pulsingSet = new Set(canvasState.pulsingAntennaIds || []);

  const canvasWidth = canvasState.canvasWidth ?? canvasState.originalImageWidth ?? metadata.imageWidth ?? null;
  const canvasHeight = canvasState.canvasHeight ?? canvasState.originalImageHeight ?? metadata.imageHeight ?? null;

  const safeCanvasWidth = canvasWidth && Number.isFinite(canvasWidth) && canvasWidth > 0 ? canvasWidth : null;
  const safeCanvasHeight = canvasHeight && Number.isFinite(canvasHeight) && canvasHeight > 0 ? canvasHeight : null;

  const coverageCandidates = [
    ...extractPolygonSets(canvasState.savedAreas),
    ...extractPolygonSets(canvasState.manualRegions),
    ...extractPolygonSets(canvasState.areas),
  ];

  const coveragePolygons = coverageCandidates
    .map((polygon, index) => {
      if (!safeCanvasWidth || !safeCanvasHeight) {
        return null;
      }
      const points = polygon.map((point) => ({
        x: clamp01(point.x / safeCanvasWidth),
        y: clamp01(point.y / safeCanvasHeight),
      }));
      if (points.length < 3) {
        return null;
      }
      return {
        id: `coverage-${floorId}-${index}`,
        points,
      };
    })
    .filter((entry): entry is { id: string; points: Point[] } => Boolean(entry));

  let coverageBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

  if (coveragePolygons.length) {
    const xs: number[] = [];
    const ys: number[] = [];
    coveragePolygons.forEach((polygon) => {
      polygon.points.forEach((point) => {
        xs.push(point.x);
        ys.push(point.y);
      });
    });
    if (xs.length && ys.length) {
      const minX = clamp01(Math.min(...xs));
      const maxX = clamp01(Math.max(...xs));
      const minY = clamp01(Math.min(...ys));
      const maxY = clamp01(Math.max(...ys));
      if (maxX > minX && maxY > minY) {
        coverageBounds = { minX, minY, maxX, maxY };
      }
    }
  }

  const antennasSnapshot: AntennaPlacementAntenna[] = antennas
    .filter((antenna): antenna is StoredAntenna & { position: Point } => {
      if (!antenna || !antenna.position) {
        return false;
      }
      return typeof antenna.position.x === "number" && typeof antenna.position.y === "number";
    })
    .map((antenna, index) => {
      const xRaw = antenna.position?.x ?? 0;
      const yRaw = antenna.position?.y ?? 0;

      const x = safeCanvasWidth ? xRaw / safeCanvasWidth : 0;
      const y = safeCanvasHeight ? yRaw / safeCanvasHeight : 0;

      const clampedX = Number.isFinite(x) ? Math.min(Math.max(x, 0), 1) : 0;
      const clampedY = Number.isFinite(y) ? Math.min(Math.max(y, 0), 1) : 0;

      const range = typeof antenna.range === "number" && Number.isFinite(antenna.range)
        ? antenna.range
        : stats.antennaRange ?? null;

      return {
        id: antenna.id || `antenna-${index}`,
        x: clampedX,
        y: clampedY,
        range: range ?? null,
        pulsing: Boolean(antenna.pulsing || (antenna.id && pulsingSet.has(antenna.id))),
        power: typeof antenna.power === "number" && Number.isFinite(antenna.power) ? antenna.power : null,
      };
    });

  return {
    floorId,
    floorName,
    orderIndex,
    imageUrl: metadata.imageUrl || "",
    thumbnailUrl: metadata.thumbnailUrl,
    imageWidth: metadata.imageWidth,
    imageHeight: metadata.imageHeight,
    canvasWidth: safeCanvasWidth ?? undefined,
    canvasHeight: safeCanvasHeight ?? undefined,
    scaleMetersPerPixel: typeof canvasState.scale === "number" && Number.isFinite(canvasState.scale)
      ? canvasState.scale
      : null,
    units: stats.units,
    antennas: antennasSnapshot,
    stats,
    coveragePolygons,
    coverageBounds,
  };
};

export const listAntennaProjects = async (): Promise<ProjectSummary[]> => {
  const firestore = getFloorplanFirestore();
  const snapshot = await firestore.collection("projects").orderBy("updatedAt", "desc").limit(50).get();

  console.info("antennaProjects:listAntennaProjects", {
    projectCount: snapshot.size,
    projectIds: snapshot.docs.map((doc) => doc.id),
  });

  const projects: ProjectSummary[] = await Promise.all(
    snapshot.docs.map(async (doc: QueryDocumentSnapshot<DocumentData>): Promise<ProjectSummary> => {
      const data = doc.data() as StoredProjectDoc & { metadata?: FloorMetadata; canvasState?: StoredCanvasState };
      const updatedAt = toDate(data.updatedAt);
      let thumbnailUrl: string | undefined;
      let floorCount = 0;
      try {
        const floorsSnap = await doc.ref.collection("floors").get();
        floorCount = floorsSnap.size;
        if (floorsSnap.size > 0) {
          for (const floorDoc of floorsSnap.docs) {
            const floorData = floorDoc.data() as StoredFloorDoc;
            if (floorData.metadata?.thumbnailUrl) {
              thumbnailUrl = floorData.metadata.thumbnailUrl;
              break;
            }
            if (floorData.metadata?.imageUrl && !thumbnailUrl) {
              thumbnailUrl = floorData.metadata.imageUrl;
            }
          }
        } else if (data?.metadata?.imageUrl) {
          thumbnailUrl = data.metadata.imageUrl;
        }
      } catch (error) {
        console.warn("antennaProjects: failed to enumerate floors", doc.id, error);
      }

      return {
        id: doc.id,
        name: data.name || `Project ${doc.id}`,
        updatedAt: updatedAt ? updatedAt.toISOString() : null,
        floorCount,
        thumbnailUrl,
      };
    }),
  );

  return projects;
};

export const listProjectFloors = async (projectId: string): Promise<FloorSummary[]> => {
  const firestore = getFloorplanFirestore();
  const projectRef = firestore.collection("projects").doc(projectId);
  const snapshot = await projectRef.collection("floors").orderBy("orderIndex", "asc").get();

  console.info("antennaProjects:listProjectFloors", {
    projectId,
    floorCount: snapshot.size,
    floorIds: snapshot.docs.map((doc) => doc.id),
  });

  return snapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => {
    const data = doc.data() as StoredFloorDoc;
    const canvasState = data.canvasState ?? {};
    const stats = computeFloorStatistics(canvasState);
    const updatedAt = toDate(data.updatedAt);

    return {
      floorId: doc.id,
      name: data.name || `Floor ${doc.id}`,
      orderIndex: typeof data.orderIndex === "number" ? data.orderIndex : 0,
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
      thumbnailUrl: data.metadata?.thumbnailUrl ?? data.metadata?.imageUrl,
      antennaCount: stats.antennaCount,
      pulsingAntennaCount: stats.pulsingAntennaCount,
      totalArea: stats.totalArea,
      units: stats.units,
    };
  });
};

export const buildAntennaPlacementSnapshot = async (
  projectId: string,
  floorIds: string[],
  generatedBy?: { uid?: string | null; email?: string | null; displayName?: string | null },
): Promise<AntennaPlacementSnapshot> => {
  const firestore = getFloorplanFirestore();
  const projectRef = firestore.collection("projects").doc(projectId);
  const projectSnap = await projectRef.get();

  if (!projectSnap.exists) {
    throw new Error("Project not found");
  }

  const projectData = projectSnap.data() as StoredProjectDoc;
  const projectUpdatedAt = toDate(projectData.updatedAt);

  const floorsToLoad = floorIds.length
    ? await Promise.all(
        floorIds.map(async (floorId) => {
          const doc = await projectRef.collection("floors").doc(floorId).get();
          if (!doc.exists) {
            throw new Error(`Floor ${floorId} not found in project ${projectId}`);
          }
          return doc;
        }),
      )
    : (await projectRef.collection("floors").orderBy("orderIndex", "asc").get()).docs;

  if (!floorsToLoad.length) {
    throw new Error("Project has no floors");
  }

  const floors: AntennaPlacementFloorSnapshot[] = floorsToLoad.map((doc: DocumentSnapshot<DocumentData>) => {
    const data = doc.data() as StoredFloorDoc;
    const canvasState = data.canvasState ?? {};
    return buildAntennaSnapshot(
      doc.id,
      data.name || `Floor ${doc.id}`,
      typeof data.orderIndex === "number" ? data.orderIndex : 0,
      data.metadata ?? {},
      canvasState,
    );
  });

  const totalAreaSqMeters = floors.reduce((sum, floor) => {
    const areaMeters = convertAreaToSquareMeters(floor.stats.totalArea, floor.stats.units);
    return sum + areaMeters;
  }, 0);

  const totalAntennaCount = floors.reduce((sum, floor) => sum + floor.stats.antennaCount, 0);
  const totalPulsingCount = floors.reduce((sum, floor) => sum + floor.stats.pulsingAntennaCount, 0);
  const summaryUnit = floors[0]?.stats.units ?? "meters";
  const summary: AntennaPlacementSummary = {
    floorCount: floors.length,
    antennaCount: totalAntennaCount,
    pulsingAntennaCount: totalPulsingCount,
    totalArea: convertAreaFromSquareMeters(totalAreaSqMeters, summaryUnit),
    units: summaryUnit,
  };

  return {
    projectId,
    projectName: projectData.name || `Project ${projectId}`,
    projectUpdatedAt: projectUpdatedAt ? projectUpdatedAt.toISOString() : null,
    generatedAt: new Date().toISOString(),
    generatedBy: generatedBy
      ? {
          uid: generatedBy.uid ?? null,
          email: generatedBy.email ?? null,
          displayName: generatedBy.displayName ?? null,
        }
      : undefined,
    floors: floors.sort((a, b) => a.orderIndex - b.orderIndex),
    summary,
  };
};

export const getAntennaProject = async (projectId: string): Promise<{ project: ProjectSummary; floors: FloorSummary[] }> => {
  const firestore = getFloorplanFirestore();
  const projectRef = firestore.collection("projects").doc(projectId);
  const snapshot = await projectRef.get();

  if (!snapshot.exists) {
    throw new Error("Project not found");
  }

  const data = snapshot.data() as StoredProjectDoc;
  const updatedAt = toDate(data.updatedAt);

  let thumbnailUrl: string | undefined;
  try {
    const firstFloor = await projectRef.collection("floors").orderBy("orderIndex", "asc").limit(1).get();
    const firstDoc = firstFloor.docs[0];
    if (firstDoc) {
      const floorData = firstDoc.data() as StoredFloorDoc;
      thumbnailUrl = floorData.metadata?.thumbnailUrl ?? floorData.metadata?.imageUrl;
    }
  } catch (error) {
    console.warn("antennaProjects: failed to load preview for project", projectId, error);
  }

  const floors = await listProjectFloors(projectId);

  return {
    project: {
      id: projectId,
      name: data.name || `Project ${projectId}`,
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
      floorCount: floors.length,
      thumbnailUrl,
    },
    floors,
  };
};

export type { ProjectSummary, FloorSummary };
