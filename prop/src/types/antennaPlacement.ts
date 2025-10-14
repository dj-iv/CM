export type LengthUnit = "meters" | "cm" | "mm" | "feet";

export interface AntennaPlacementAntenna {
  id: string;
  x: number;
  y: number;
  range: number | null;
  pulsing: boolean;
  power?: number | null;
}

export interface AntennaPlacementCoveragePolygon {
  id: string;
  points: Array<{ x: number; y: number }>;
}

export interface AntennaPlacementAreaSummary {
  id: string;
  label: string;
  area: number;
}

export interface AntennaPlacementFloorStats {
  antennaCount: number;
  pulsingAntennaCount: number;
  totalArea: number;
  areaSummaries: AntennaPlacementAreaSummary[];
  units: LengthUnit;
  antennaRange?: number | null;
}

export interface AntennaPlacementFloorSnapshot {
  floorId: string;
  floorName: string;
  orderIndex: number;
  imageUrl: string;
  thumbnailUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  scaleMetersPerPixel?: number | null;
  units: LengthUnit;
  antennas: AntennaPlacementAntenna[];
  stats: AntennaPlacementFloorStats;
  coveragePolygons?: AntennaPlacementCoveragePolygon[];
  coverageBounds?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null;
}

export interface AntennaPlacementSummary {
  floorCount: number;
  antennaCount: number;
  pulsingAntennaCount: number;
  totalArea: number;
  units: LengthUnit;
}

export interface AntennaPlacementSnapshot {
  projectId: string;
  projectName: string;
  projectUpdatedAt?: string | null;
  generatedAt: string;
  generatedBy?: {
    uid: string | null;
    email?: string | null;
    displayName?: string | null;
  } | null;
  floors: AntennaPlacementFloorSnapshot[];
  summary: AntennaPlacementSummary;
  notes?: string;
}
