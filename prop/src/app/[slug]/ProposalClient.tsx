"use client";

/* eslint-disable @next/next/no-page-custom-font */
/* eslint-disable @next/next/no-img-element */

import Head from "next/head";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { createPdfDownloadHandler } from "./pdfExport";
import type { DecodedProposal } from "./page";
import "./proposal.css";
import { buildDefaultIntroduction } from "@/lib/proposalCopy";
import type {
  AntennaPlacementAntenna,
  AntennaPlacementCoveragePolygon,
  AntennaPlacementFloorSnapshot,
  AntennaPlacementSnapshot,
  LengthUnit,
} from "@/types/antennaPlacement";

type SupportTier = "bronze" | "silver" | "gold";

interface ProposalClientProps {
  slug: string;
  proposal: DecodedProposal | null;
  introduction: string | null;
  error: string | null;
  antennaPlacement: AntennaPlacementSnapshot | null;
}

interface SolutionContent {
  architecture: string;
  components: string;
}

const VIDEO_ID = "izDp2EcQOhs";
const VIDEO_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const VIDEO_THUMBNAIL = `https://img.youtube.com/vi/${VIDEO_ID}/hqdefault.jpg`;
const VIDEO_EMBED_HTML = `
    <div class="embedded-video">
        <iframe src="https://www.youtube.com/embed/${VIDEO_ID}" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
        <a class="video-fallback" href="${VIDEO_URL}" target="_blank" rel="noopener">
            <img src="${VIDEO_THUMBNAIL}" alt="Watch the CEL-FI overview video on YouTube">
            <span>Watch this video on YouTube</span>
        </a>
    </div>`;

const solutionSpecificData: Record<string, SolutionContent> = {
  G41: {
    architecture: `
            <h3 class="no-number">CEL-FI</h3>
            <p>UCtel proposes to deploy solutions from Nextivity. Nextivity manufactures the CEL-FI suite of cellular coverage solutions which are designed to optimise mobile signal coverage within buildings and vehicles. CEL-FI is unconditionally network safe, as it prevents interference with mobile operator networks and in the UK CEL-FI products are licence-exempt and fully comply with Ofcom’s UK Interface requirement 2102 (IR2102).</p>
            ${VIDEO_EMBED_HTML}
            <div class="force-page-break" style="page-break-before: always; break-before: page;"></div>
            <h3>CEL-FI G41 System Architecture</h3>
            <div class="arch-section">
                <p>The CEL-FI solution needs to receive the best available donor signal from outside and transport the signal through low loss cable to the network repeaters that then distribute the signal through indoor antennas. A system comprises:</p>
                <ul>
                    <li>Donor antenna installed where the best donor signal can be obtained</li>
                    <li>Low loss cables</li>
                    <li>Repeaters to receive donor signal and boost it</li>
                    <li>Internal antennas to broadcast the boosted signal</li>
                </ul>
                <img class="arch-diagram" src="/images/g41_diagrams.png" alt="G41 Installation Diagrams">
            </div>`,
    components: `
            <div class="component-layout"><div class="image-container"><img src="/images/donor_antenna.png" alt="Donor Antenna"></div><div class="text-container"><h3>Donor Antenna</h3><p>One or more donor antennas will be installed on the roof (or other suitable location) to obtain the best signal for boosting. The type of donor antenna will be selected during the site survey. The image shows an example of a roof installation. Low loss coaxial cables will be run from the donor antennas to the boosters.</p></div></div>
            <div class="component-layout reverse"><div class="image-container"><img src="/images/g41_boosters.png" alt="G41 Boosters"></div><div class="text-container"><h3>G41 Booster</h3><p>CEL-FI Go G41 booster(s) will be installed in a suitable location and either wall or rack-mounted. Typical locations are comms rooms or riser cupboards. Power will be required for the booster(s) and management router if remote management is required.</p></div></div>
            <div class="force-page-break" style="page-break-before: always; break-before: page;"></div>
            <div class="component-layout"><div class="image-container"><img src="/images/server_antennas.png" alt="Server Antennas"></div><div class="text-container"><h3>Server Antennas</h3><p>Depending on the environment the appropriate type of antenna will be installed. There are a range of ceiling and panel omni antennas available and the most appropriate antenna will be recommended following the survey.</p></div></div>
            <div class="force-page-break" style="page-break-before: always; break-before: page;"></div>
            <div class="component-layout reverse"><div class="image-container"><img src="/images/cabling.png" alt="Cabling"></div><div class="text-container"><h3>Cabling</h3><p>Coaxial cable carries the analogue signal and is low-loss to ensure the maximum signal is delivered to antennas.</p></div></div>`,
  },
  G43: {
    architecture: `
            <h3 class="no-number">CEL-FI</h3>
            <p>UCtel proposes to deploy solutions from Nextivity. Nextivity manufactures the CEL-FI suite of cellular coverage solutions which are designed to optimise mobile signal coverage within buildings and vehicles. CEL-FI is unconditionally network safe, as it prevents interference with mobile operator networks and in the UK CEL-FI products are licence-exempt and fully comply with Ofcom’s UK Interface requirement 2102 (IR2102).</p>
            ${VIDEO_EMBED_HTML}
            <div class="force-page-break" style="page-break-before: always; break-before: page;"></div>
            <h3>CEL-FI G43 System Architecture</h3>
            <div class="arch-section">
                <p>The CEL-FI solution needs to receive the best available donor signal from outside and transport the signal through low loss cable to the network repeaters that then distribute the signal through indoor antennas. A system comprises:</p>
                <ul>
                    <li>Donor antenna installed where the best donor signal can be obtained</li>
                    <li>Low loss cables</li>
                    <li>Repeaters to receive donor signal and boost it</li>
                    <li>Internal antennas to broadcast the boosted signal</li>
                </ul>
                <img class="arch-diagram" src="/images/g43_diagram.png" alt="G43 Installation Diagram">
            </div>`,
    components: `
            <div class="component-layout"><div class="image-container"><img src="/images/donor_antenna.png" alt="Donor Antenna"></div><div class="text-container"><h3>Donor Antenna</h3><p>One or more donor antennas will be installed on the roof (or other suitable location) to obtain the best signal for boosting. The type of donor antenna will be selected during the site survey. The image shows an example of a roof installation. Low loss coaxial cables will be run from the donor antennas to the boosters.</p></div></div>
            <div class="component-layout reverse"><div class="image-container"><img src="/images/g43_booster.png" alt="G43 Booster"></div><div class="text-container"><h3>G43 Booster</h3><p>CEL-FI GO G43 booster(s) will be installed in a suitable location and either wall or rack-mounted. Typical locations are comms rooms or riser cupboards. Power will be required for the booster(s) and management router if remote management is required.</p></div></div>
            <div class="force-page-break" style="page-break-before: always; break-before: page;"></div>
            <div class="component-layout"><div class="image-container"><img src="/images/server_antennas.png" alt="Server Antennas"></div><div class="text-container"><h3>Server Antennas</h3><p>Depending on the environment the appropriate type of antenna will be installed. There are a range of ceiling and panel omni antennas available and the most appropriate antenna will be recommended following the survey.</p></div></div>
            <div class="force-page-break" style="page-break-before: always; break-before: page;"></div>
            <div class="component-layout reverse"><div class="image-container"><img src="/images/cabling.png" alt="Cabling"></div><div class="text-container"><h3>Cabling</h3><p>Coaxial cable carries the analogue signal and is low-loss to ensure the maximum signal is delivered to antennas.</p></div></div>`,
  },
  QUATRA: {
    architecture: `
            <h3 class="no-number">CEL-FI</h3>
            <p>UCtel proposes to deploy solutions from Nextivity. Nextivity manufactures the CEL-FI suite of cellular coverage solutions which are designed to optimise mobile signal coverage within buildings and vehicles. CEL-FI is unconditionally network safe, as it prevents interference with mobile operator networks and in the UK, CEL-FI products are licence-exempt and fully comply with Ofcom’s UK Interface requirement 2102 (IR2102).</p>
            ${VIDEO_EMBED_HTML}
            <h3 class="force-page-break">CEL-FI QUATRA 4000e</h3>
            <p>CEL-FI QUATRA is a distributed antenna system (DAS) hybrid solution that combines the strength of passive and active DAS technologies to deliver high-quality mobile signal in buildings. The QUATRA 4000e boosts up to 4 network operators in a single system and complies with recent changes to Ofcom’s regulations in this regard.</p>
            <img src="/images/quatra_diagram.png" alt="QUATRA 4000e Architecture Diagram">`,
    components: `
            <div class="component-layout"><div class="image-container"><img src="/images/donor_antenna.png" alt="Donor Antenna"></div><div class="text-container"><h3>Donor Antenna</h3><p>Donor antennas will be installed on the roof (or other suitable location) to obtain the best signal for boosting. The type of donor antenna will be selected during the site survey. The image shows an example of a roof installation. Low loss coaxial cables will be run from the donor antennas to the QUATRA Network Unit.</p></div></div>
            <div class="component-layout reverse"><div class="image-container"><img src="/images/network_unit.png" alt="Network Unit"></div><div class="text-container"><h3>Network Unit</h3><p>CEL-FI QUATRA 4000e Network Units (NUs) will be installed in a suitable location and either wall or rack mounted. Typical locations are comms rooms or riser cupboard. Power will be required for the NU. An NU can support up to 6 CUs. A fibre hub can be added to expand the capacity to 12 CUs.</p></div></div>
            <div class="component-layout"><div class="image-container"><img src="/images/coverage_unit.png" alt="Coverage Unit"></div><div class="text-container"><h3>Coverage Unit</h3><p>Coverage Units are installed on the wall or ceiling in each of the areas that require coverage. Two CAT6 cables connect each CU to the NU providing power over PoE. A server antenna or segments of passive DAS will be connected to each CU to distribute the signal across the required area.</p></div></div>
            <div class="component-layout reverse"><div class="image-container"><img src="/images/server_antennas.png" alt="Server Antennas"></div><div class="text-container"><h3 class="force-page-break">Server Antennas</h3><p>Depending on the environment the appropriate type of antenna will be installed. There are a range of ceiling and panel omni antennas available and the most appropriate antenna will be recommended following the survey.</p></div></div>
            <div class="component-layout"><div class="image-container"><img src="/images/cabling_quatra.png" alt="Quatra Cabling"></div><div class="text-container"><h3>Cabling</h3><p>Structured cabling will be used to connect active components together and coaxial cabling to connect antennas. Some installations involve fibre optic cable to maximise the distance between NU and CU, but will require a dedicated power at the other end.</p></div></div>`,
  },
  QUATRA_100M: {
    architecture: `
      <h3 class="no-number">CEL-FI</h3>
      <p>UCtel proposes to deploy solutions from Nextivity. Nextivity manufactures the CEL-FI suite of cellular coverage solutions which are designed to optimise mobile signal coverage within buildings and vehicles. CEL-FI is unconditionally network safe, as it prevents interference with mobile operator networks and in the UK, CEL-FI products are licence-exempt and fully comply with Ofcom’s UK Interface requirement 2102 (IR2102).</p>
      ${VIDEO_EMBED_HTML}
      <h3 class="force-page-break">CEL-FI QUATRA 100M</h3>
      <p>CEL-FI QUATRA 100M combines active head-end electronics with coax-fed coverage units to support sites where passive DAS cabling already exists or long copper runs are required. The 100M platform maintains network-safe amplification while delivering multi-operator coverage over extended distances.</p>
      <img src="/images/100m_diagram.png" alt="QUATRA 100M Architecture Diagram">`,
    components: `
      <div class="component-layout"><div class="image-container"><img src="/images/donor_antenna.png" alt="Donor Antenna"></div><div class="text-container"><h3>Donor Antenna</h3><p>Donor antennas will be installed on the roof (or other suitable location) to obtain the best signal for boosting. The type of donor antenna will be confirmed during the site survey. Low loss coaxial cables will be run from the donor antennas to the QUATRA 100M Network Unit.</p></div></div>
      <div class="component-layout reverse"><div class="image-container"><img src="/images/network_unit_100m.png" alt="QUATRA 100M Network Unit"></div><div class="text-container"><h3>Network Unit</h3><p>The QUATRA 100M Network Unit (NU) will be wall or rack mounted in a comms space. Each NU can feed up to six coverage units over 100 metres of coax. Power and management connectivity are provided at the NU.</p></div></div>
      <div class="component-layout"><div class="image-container"><img src="/images/coverage_unit_100m.png" alt="QUATRA 100M Coverage Unit"></div><div class="text-container"><h3>Coverage Unit</h3><p>Coverage Units are positioned within the areas requiring mobile signal. They connect back to the NU via low-loss coaxial cable and drive the passive antenna segments serving each zone.</p></div></div>
      <div class="component-layout reverse"><div class="image-container"><img src="/images/power_unit_100m.png" alt="QUATRA 100M Power Unit"></div><div class="text-container"><h3 class="force-page-break">Power Unit</h3><p>Remote Power Units (RPUs) are installed where local powering of coverage points is required. The RPU converts mains power to the correct supply for the 100M coverage hardware and incorporates the necessary protection.</p></div></div>
      <div class="component-layout"><div class="image-container"><img src="/images/cabling_quatra.png" alt="Quatra Cabling"></div><div class="text-container"><h3>Cabling</h3><p>Structured cabling and coaxial runs are designed to maintain signal quality over 100 metre spans. Existing passive DAS infrastructure can often be reused to accelerate deployment.</p></div></div>`,
  },
  QUATRA_EVO: {
    architecture: `
            <h3 class="no-number">CEL-FI</h3>
            <p>UCtel proposes to deploy solutions from Nextivity. Nextivity manufactures the CEL-FI suite of cellular coverage solutions which are designed to optimise mobile signal coverage within buildings and vehicles. CEL-FI is unconditionally network safe, as it prevents interference with mobile operator networks and in the UK, CEL-FI products are licence-exempt and fully comply with Ofcom’s UK Interface requirement 2102 (IR2102).</p>
            ${VIDEO_EMBED_HTML}
            <h3 class="force-page-break">CEL-FI QUATRA EVO</h3>
            <p>CEL-FI QUATRA is a distributed antenna system (DAS) hybrid solution that combines the strength of passive and active DAS technologies to deliver high-quality mobile signal in buildings. The QUATRA EVO can boost two network operators in a single system and complies with recent changes to Ofcom’s regulations in this regard.</p>
            <img src="/images/evo_diagram.png" alt="QUATRA EVO Architecture Diagram">`,
    components: `
            <div class="component-layout"><div class="image-container"><img src="/images/donor_antenna.png" alt="Donor Antenna"></div><div class="text-container"><h3>Donor Antenna</h3><p>Donor antennas will be installed on the roof (or other suitable location) to obtain the best signal for boosting. The type of donor antenna will be selected during the site survey. The image shows an example of a roof installation. Low loss coaxial cables will be run from the donor antennas to the QUATRA Network Unit.</p></div></div>
            <div class="component-layout reverse"><div class="image-container"><img src="/images/network_unit_evo.png" alt="EVO Network Unit"></div><div class="text-container"><h3>Network Unit</h3><p>CEL-FI QUATRA EVO Network Units (NUs) will be installed in a suitable location and either wall or rack mounted. Typical locations are comms rooms or riser cupboard. Power will be required for the NU. An NU can support up to 6 CUs. A fibre hub can be added to expand the capacity to 12 CUs.</p></div></div>
            <div class="component-layout"><div class="image-container"><img src="/images/coverage_unit.png" alt="Coverage Unit"></div><div class="text-container"><h3>Coverage Unit</h3><p>Coverage Units are installed on the wall or ceiling in each of the areas that require coverage. Two CAT6 cables connect each CU to the NU providing power over PoE. A server antenna or segments of passive DAS will be connected to each CU to distribute the signal across the required area.</p></div></div>
            <div class="component-layout reverse"><div class="image-container"><img src="/images/server_antennas.png" alt="Server Antennas"></div><div class="text-container"><h3 class="force-page-break">Server Antennas</h3><p>Depending on the environment the appropriate type of antenna will be installed. There are a range of ceiling and panel omni antennas available and the most appropriate antenna will be recommended following the survey.</p></div></div>
            <div class="component-layout"><div class="image-container"><img src="/images/cabling_quatra.png" alt="Quatra Cabling"></div><div class="text-container"><h3>Cabling</h3><p>Structured cabling will be used to connect active components together and coaxial cabling to connect antennas. Some installations involve fibre optic cable to maximise the distance between NU and CU, but will require a dedicated power at the other end.</p></div></div>`,
  },
};

const SUPPORT_TIERS: SupportTier[] = ["bronze", "silver", "gold"];

const normalizeKey = (value: string): string =>
  value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");

const readProposalString = (proposal: DecodedProposal | null, ...keys: string[]): string => {
  if (!proposal) {
    return "";
  }
  for (const key of keys) {
    const value = proposal[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const deriveSolutionKey = (proposal: DecodedProposal | null): keyof typeof solutionSpecificData | null => {
  if (!proposal) {
    return null;
  }

  const normalizedSystemType = normalizeKey(readProposalString(proposal, "systemType", "SystemType", "solutionType"));
  const trimmedSystemType = normalizedSystemType.replace(/_DAS$/, "");
  if (trimmedSystemType && trimmedSystemType in solutionSpecificData) {
    return trimmedSystemType as keyof typeof solutionSpecificData;
  }

  const normalizedSolution = normalizeKey(readProposalString(proposal, "Solution", "solution", "solutionName"));
  const combined = `${normalizedSystemType} ${normalizedSolution}`.trim();

  if (combined.includes("100M")) {
    return "QUATRA_100M";
  }
  if (combined.includes("G43")) {
    return "G43";
  }
  if (combined.includes("G41")) {
    return "G41";
  }
  if (combined.includes("EVO")) {
    return "QUATRA_EVO";
  }
  if (combined.includes("QUATRA")) {
    return "QUATRA";
  }

  return null;
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

type CoverageBounds = NonNullable<AntennaPlacementFloorSnapshot["coverageBounds"]>;

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isValidCoverageBounds = (
  bounds: AntennaPlacementFloorSnapshot["coverageBounds"],
): bounds is CoverageBounds => {
  if (!bounds) {
    return false;
  }
  const { minX, minY, maxX, maxY } = bounds;
  return (
    isFiniteNumber(minX) &&
    isFiniteNumber(minY) &&
    isFiniteNumber(maxX) &&
    isFiniteNumber(maxY) &&
    maxX > minX &&
    maxY > minY
  );
};

const coveragePolygonToPath = (points: AntennaPlacementCoveragePolygon["points"]): string => {
  if (!Array.isArray(points) || points.length < 3) {
    return "";
  }

  const segments: string[] = [];
  points.forEach((point, index) => {
    if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
      return;
    }
    const x = clamp(point.x, 0, 1).toFixed(6);
    const y = clamp(point.y, 0, 1).toFixed(6);
    segments.push(`${index === 0 ? "M" : "L"} ${x} ${y}`);
  });

  if (segments.length < 3) {
    return "";
  }

  segments.push("Z");
  return segments.join(" ");
};

const computeCoverageBoundsFromPolygons = (
  polygons: AntennaPlacementCoveragePolygon[],
): CoverageBounds | null => {
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

const isPointOnSegment = (
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
  tolerance = 1e-6,
): boolean => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq <= tolerance) {
    const distance = Math.hypot(point.x - start.x, point.y - start.y);
    return distance <= tolerance;
  }

  const cross = (point.x - start.x) * dy - (point.y - start.y) * dx;
  if (Math.abs(cross) > tolerance) {
    return false;
  }

  const dot = (point.x - start.x) * dx + (point.y - start.y) * dy;
  return dot >= -tolerance && dot <= lengthSq + tolerance;
};

const isPointInPolygon = (
  point: { x: number; y: number },
  polygon: AntennaPlacementCoveragePolygon["points"],
): boolean => {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }

  const target = {
    x: clamp(point.x, 0, 1),
    y: clamp(point.y, 0, 1),
  };

  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const current = polygon[i];
    const previous = polygon[j];

    if (
      !current ||
      !previous ||
      !isFiniteNumber(current.x) ||
      !isFiniteNumber(current.y) ||
      !isFiniteNumber(previous.x) ||
      !isFiniteNumber(previous.y)
    ) {
      continue;
    }

    const currentPoint = { x: clamp(current.x, 0, 1), y: clamp(current.y, 0, 1) };
    const previousPoint = { x: clamp(previous.x, 0, 1), y: clamp(previous.y, 0, 1) };

    if (isPointOnSegment(target, previousPoint, currentPoint)) {
      return true;
    }

    const intersects =
      (currentPoint.y > target.y) !== (previousPoint.y > target.y) &&
      target.x <
        ((previousPoint.x - currentPoint.x) * (target.y - currentPoint.y)) /
          ((previousPoint.y - currentPoint.y) || Number.EPSILON) +
          currentPoint.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const isPointInsideCoverage = (
  point: { x: number; y: number },
  polygons: AntennaPlacementCoveragePolygon[],
): boolean => {
  if (!Array.isArray(polygons) || !polygons.length) {
    return true;
  }

  const candidate = {
    x: clamp(point.x, 0, 1),
    y: clamp(point.y, 0, 1),
  };

  return polygons.some((polygon) => isPointInPolygon(candidate, polygon.points));
};

const computeFloorplanZoomStyle = (
  antennas: AntennaPlacementAntenna[],
  coverageBounds?: AntennaPlacementFloorSnapshot["coverageBounds"],
): CSSProperties | undefined => {
  const hasCoverageBounds = isValidCoverageBounds(coverageBounds);

  const validPoints = Array.isArray(antennas)
    ? antennas.filter(
        (antenna): antenna is AntennaPlacementAntenna =>
          Boolean(antenna) && isFiniteNumber(antenna.x) && isFiniteNumber(antenna.y),
      )
    : [];

  if (!hasCoverageBounds && !validPoints.length) {
    return undefined;
  }

  const COVERAGE_PADDING = 0.05;
  const ANTENNA_PADDING = 0.08;
  const MIN_VIEWPORT = 0.4;
  const MAX_SCALE = 1 / MIN_VIEWPORT;

  let minX: number;
  let maxX: number;
  let minY: number;
  let maxY: number;

  if (hasCoverageBounds && coverageBounds) {
    minX = clamp(coverageBounds.minX - COVERAGE_PADDING, 0, 1);
    maxX = clamp(coverageBounds.maxX + COVERAGE_PADDING, 0, 1);
    minY = clamp(coverageBounds.minY - COVERAGE_PADDING, 0, 1);
    maxY = clamp(coverageBounds.maxY + COVERAGE_PADDING, 0, 1);
  } else {
    let antennaMinX = 1;
    let antennaMaxX = 0;
    let antennaMinY = 1;
    let antennaMaxY = 0;

    for (const point of validPoints) {
      antennaMinX = point.x < antennaMinX ? point.x : antennaMinX;
      antennaMaxX = point.x > antennaMaxX ? point.x : antennaMaxX;
      antennaMinY = point.y < antennaMinY ? point.y : antennaMinY;
      antennaMaxY = point.y > antennaMaxY ? point.y : antennaMaxY;
    }

    minX = clamp(antennaMinX - ANTENNA_PADDING, 0, 1);
    maxX = clamp(antennaMaxX + ANTENNA_PADDING, 0, 1);
    minY = clamp(antennaMinY - ANTENNA_PADDING, 0, 1);
    maxY = clamp(antennaMaxY + ANTENNA_PADDING, 0, 1);
  }

  const width = Math.max(maxX - minX, 0.05);
  const height = Math.max(maxY - minY, 0.05);

  let scale = Math.min(1 / width, 1 / height);
  scale = clamp(scale, 1, MAX_SCALE);

  const viewWidth = 1 / scale;
  const viewHeight = 1 / scale;
  const halfViewWidth = viewWidth / 2;
  const halfViewHeight = viewHeight / 2;

  const desiredCenterX = clamp(0.5, halfViewWidth, 1 - halfViewWidth);
  const desiredCenterY = clamp(0.5, halfViewHeight, 1 - halfViewHeight);

  const maxOffsetX = Math.max(0, 1 - viewWidth);
  const maxOffsetY = Math.max(0, 1 - viewHeight);

  let offsetX = clamp(desiredCenterX - halfViewWidth, 0, maxOffsetX);
  let offsetY = clamp(desiredCenterY - halfViewHeight, 0, maxOffsetY);

  const minOffsetXForBounds = Math.max(0, maxX - viewWidth);
  const maxOffsetXForBounds = Math.min(maxOffsetX, Math.max(minX, 0));
  if (minOffsetXForBounds <= maxOffsetXForBounds) {
    offsetX = clamp(offsetX, minOffsetXForBounds, maxOffsetXForBounds);
  }

  const minOffsetYForBounds = Math.max(0, maxY - viewHeight);
  const maxOffsetYForBounds = Math.min(maxOffsetY, Math.max(minY, 0));
  if (minOffsetYForBounds <= maxOffsetYForBounds) {
    offsetY = clamp(offsetY, minOffsetYForBounds, maxOffsetYForBounds);
  }

  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    return undefined;
  }

  const translateX = (offsetX * 100) / scale;
  const translateY = (offsetY * 100) / scale;

  return {
    transform: `scale(${scale.toFixed(4)}) translate(${-translateX.toFixed(4)}%, ${-translateY.toFixed(4)}%)`,
    willChange: "transform",
  } as CSSProperties;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getFormattedDate(): string {
  const date = new Date();
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  return `${day}${month}${year}`;
}

function toDisplayString(value: unknown, fallback = ""): string {
  if (typeof value === "number") {
    return value.toString();
  }
  if (typeof value === "string") {
    return value;
  }
  return fallback;
}

function sanitizeFilenameSegment(value: string): string {
  return value.trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
}

function parseCurrency(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const stringValue = typeof value === "string" ? value : String(value);
  const cleaned = stringValue.replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `£${safeValue.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const AREA_SUFFIX: Record<LengthUnit, string> = {
  meters: "m²",
  feet: "ft²",
  cm: "cm²",
  mm: "mm²",
};

const LENGTH_SUFFIX: Record<LengthUnit, string> = {
  meters: "m",
  feet: "ft",
  cm: "cm",
  mm: "mm",
};

const formatCount = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Math.round(value).toLocaleString("en-GB");
};

const formatAreaValue = (value: number, unit: LengthUnit, maximumFractionDigits = 1): string => {
  const safeValue = Number.isFinite(value) ? value : 0;
  const formatted = safeValue.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
  return `${formatted} ${AREA_SUFFIX[unit] ?? "m²"}`;
};

const formatLengthValue = (value: number, unit: LengthUnit): string => {
  const safeValue = Number.isFinite(value) ? value : 0;
  const formatted = safeValue.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  return `${formatted} ${LENGTH_SUFFIX[unit] ?? "m"}`;
};

const formatIsoDateTime = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const PAGE_SELECTOR = ".page:not(.cover-page)";
const HEADING_SELECTOR =
  ".page:not(.cover-page):not(.toc-page) h2:not(.no-number), .page:not(.cover-page):not(.toc-page) h3:not(.no-number)";
const HEADING_NUMBER_ATTRIBUTE = "data-heading-number";

const cleanHeadingText = (value: string): string =>
  value.replace(/^\d+(?:\.\d+)*\s+/, "").replace(/\s+/g, " ").trim();

const createSlugBase = (text: string, fallback: string, counts: Map<string, number>): string => {
  const sanitized = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const base = sanitized || fallback;
  const occurrence = counts.get(base) ?? 0;
  counts.set(base, occurrence + 1);
  return occurrence ? `${base}-${occurrence + 1}` : base;
};

const updateProposalOutline = (container: HTMLElement, tocList: HTMLElement): void => {
  container.querySelectorAll<HTMLElement>(`[${HEADING_NUMBER_ATTRIBUTE}]`).forEach((heading) => {
    heading.removeAttribute(HEADING_NUMBER_ATTRIBUTE);
  });
  tocList.innerHTML = "";

  const pages = Array.from(container.querySelectorAll<HTMLElement>(PAGE_SELECTOR));
  pages.forEach((page, index) => {
    const pageNumberNode = page.querySelector<HTMLElement>(".footer .page-number");
    if (pageNumberNode) {
      pageNumberNode.textContent = String(index + 2);
    }
  });

  const headings = Array.from(container.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
  let sectionCounter = 0;
  let subsectionCounter = 0;
  const slugCounts = new Map<string, number>();

  headings.forEach((heading) => {
    const isSection = heading.tagName === "H2";

    if (isSection) {
      sectionCounter += 1;
      subsectionCounter = 0;
    } else {
      subsectionCounter += 1;
    }

    const displayNumber = isSection ? `${sectionCounter}` : `${sectionCounter}.${subsectionCounter}`;
    const headingText = cleanHeadingText(heading.textContent ?? "");

    if (!headingText) {
      return;
    }

    const slugBase = createSlugBase(headingText, displayNumber.replace(/\./g, "-"), slugCounts);
    const slug = `section-${slugBase}`;
    heading.id = slug;

    heading.setAttribute(HEADING_NUMBER_ATTRIBUTE, displayNumber);

    const pageNumberText = heading.closest(".page")?.querySelector(".footer .page-number")?.textContent ?? "";

    const doc = heading.ownerDocument;
    const listItem = doc.createElement("li");
    listItem.className = isSection ? "toc-h2" : "toc-h3";

    const anchor = doc.createElement("a");
    anchor.href = `#${slug}`;

    const titleSpan = doc.createElement("span");
    titleSpan.textContent = `${displayNumber} ${headingText}`;

    const pageSpan = doc.createElement("span");
    pageSpan.textContent = pageNumberText;

    anchor.append(titleSpan, pageSpan);
    listItem.appendChild(anchor);
    tocList.appendChild(listItem);
  });
};

export default function ProposalClient({ slug, proposal, introduction, error, antennaPlacement }: ProposalClientProps) {
  const [selectedTier, setSelectedTier] = useState<SupportTier | null>(null);
  const supportRowClass = (tier: SupportTier) =>
    selectedTier === tier ? "support-tier-option selected" : "support-tier-option";

  const placementFloors = useMemo<AntennaPlacementSnapshot["floors"]>(() => {
    if (!antennaPlacement?.floors || !antennaPlacement.floors.length) {
      return [] as AntennaPlacementSnapshot["floors"];
    }
    const floors = [...antennaPlacement.floors];
    floors.sort((a, b) => {
      if (a.orderIndex !== b.orderIndex) {
        return a.orderIndex - b.orderIndex;
      }
      return a.floorName.localeCompare(b.floorName);
    });
    return floors;
  }, [antennaPlacement]);

  const hasAntennaPlacement = placementFloors.length > 0;
  const placementSummary = antennaPlacement?.summary ?? null;
  const placementNotes = antennaPlacement?.notes?.trim() || "";
  const placementGeneratedAt = formatIsoDateTime(antennaPlacement?.generatedAt);
  const placementProjectUpdatedAt = formatIsoDateTime(antennaPlacement?.projectUpdatedAt);
  const placementGeneratedBy = antennaPlacement?.generatedBy?.displayName
    || antennaPlacement?.generatedBy?.email
    || null;

  const aggregatePlacementSummary = useMemo(() => {
    if (!hasAntennaPlacement) {
      return null as null | {
        floorCount: number;
        antennaCount: number;
        totalAreaLabel: string;
        units: LengthUnit;
      };
    }

    if (placementSummary) {
      return {
        floorCount: placementSummary.floorCount,
        antennaCount: placementSummary.antennaCount,
        totalAreaLabel: formatAreaValue(placementSummary.totalArea, placementSummary.units),
        units: placementSummary.units,
      };
    }

    const derivedUnits: LengthUnit = placementFloors[0]?.stats.units ?? "meters";
    const totalArea = placementFloors.reduce((sum, floor) => {
      const area = Number.isFinite(floor.stats.totalArea) ? floor.stats.totalArea : 0;
      return sum + area;
    }, 0);
    const antennaCount = placementFloors.reduce((sum, floor) => sum + floor.stats.antennaCount, 0);
    return {
      floorCount: placementFloors.length,
      antennaCount,
      totalAreaLabel: formatAreaValue(totalArea, derivedUnits),
      units: derivedUnits,
    };
  }, [hasAntennaPlacement, placementSummary, placementFloors]);

  const placementFloorCount = aggregatePlacementSummary?.floorCount ?? placementFloors.length;
  const placementAntennaCount = aggregatePlacementSummary?.antennaCount ?? 0;
  const placementAreaLabel = aggregatePlacementSummary?.totalAreaLabel ?? "—";
  const hasPlacementNotes = Boolean(placementNotes);

  useEffect(() => {
    document.body.classList.add("proposal-body");
    return () => {
      document.body.classList.remove("proposal-body");
    };
  }, []);

  const computedTitle = useMemo(() => {
    if (!proposal) {
      return "UCtel Proposal";
    }

    const solution = sanitizeFilenameSegment(toDisplayString(proposal.Solution ?? proposal.solutionType ?? "Solution", "Solution"));
    const networks = sanitizeFilenameSegment(toDisplayString(proposal.NumberOfNetworks ?? "", "").toString() || "Networks");
    const accountName = sanitizeFilenameSegment(toDisplayString(proposal.Account ?? proposal.CustomerName ?? "Customer", "Customer"));
    return `UCtel_Proposal_${solution}_${networks}_Networks_for_${accountName}_${getFormattedDate()}`;
  }, [proposal]);

  useEffect(() => {
    if (proposal) {
      document.title = computedTitle;
    }
  }, [proposal, computedTitle]);

  const derivedSolutionKey = useMemo(() => deriveSolutionKey(proposal), [proposal]);
  const solutionContent = derivedSolutionKey ? solutionSpecificData[derivedSolutionKey] : undefined;
  const architectureHtml = solutionContent?.architecture ?? "";
  const componentsHtml = solutionContent?.components ?? "";

  useEffect(() => {
    if (!proposal) {
      setSelectedTier(null);
      return;
    }

    const description = toDisplayString(proposal.Description4 ?? proposal.description4 ?? "", "").toLowerCase();
    const matchedTier = SUPPORT_TIERS.find((tier) => (tier === "gold" ? description.includes("gold") : description.includes(tier)));
    setSelectedTier(matchedTier ?? null);
  }, [proposal]);

  useEffect(() => {
    if (!proposal) {
      return;
    }

    const options = Array.from(document.querySelectorAll<HTMLTableRowElement>(".support-tier-option"));
    if (!options.length) {
      return;
    }

    const listeners: Array<{ element: HTMLTableRowElement; handler: () => void }> = [];

    options.forEach((option) => {
      const tier = option.dataset.tier as SupportTier | undefined;
      if (!tier) {
        return;
      }

      const handler = () => {
        setSelectedTier((current) => (current === tier ? null : tier));
      };

      option.addEventListener("click", handler);
      listeners.push({ element: option, handler });
    });

    return () => {
      listeners.forEach(({ element, handler }) => {
        element.removeEventListener("click", handler);
      });
    };
  }, [proposal]);

  useEffect(() => {
    if (!proposal) {
      return;
    }

    const supportRow = document.getElementById("support-row-initial") as HTMLTableRowElement | null;
    const grandTotalElem = document.getElementById("grand-total-price");
    if (!supportRow || !grandTotalElem) {
      return;
    }

    const cells = supportRow.cells;
    if (!cells || cells.length < 4) {
      return;
    }

    const initialData = {
      desc: toDisplayString(proposal.Description4 ?? proposal.description4 ?? "", ""),
      qty: toDisplayString(proposal.Qty4 ?? proposal.qty4 ?? "", ""),
      unit: toDisplayString(proposal.UnitPrice4 ?? proposal.unitPrice4 ?? "", ""),
      total: toDisplayString(proposal.TotalPrice4 ?? proposal.totalPrice4 ?? "", ""),
    };

    const totalPriceText = toDisplayString(proposal.TotalPrice ?? proposal.totalPrice ?? "", "");
    const headerTotal = parseCurrency(totalPriceText || initialData.total);
    const initialSupport = parseCurrency(initialData.total);
    const baseTotal = headerTotal - initialSupport;

    if (!selectedTier) {
      cells[0].textContent = initialData.desc;
      cells[1].textContent = initialData.qty;
      cells[2].textContent = initialData.unit;
      cells[3].textContent = initialData.total;

      if (totalPriceText) {
        grandTotalElem.textContent = totalPriceText;
      } else if (initialData.total) {
        grandTotalElem.textContent = formatCurrency(baseTotal + initialSupport);
      } else {
        grandTotalElem.textContent = formatCurrency(baseTotal);
      }
      return;
    }

    const tierIndex = SUPPORT_TIERS.indexOf(selectedTier);
    const tierTotalRaw = proposal[`SupportTotalPrice${tierIndex + 1}` as keyof DecodedProposal];
    const tierValue = parseCurrency(tierTotalRaw);
    const newGrandTotal = baseTotal + tierValue;

    const tierLabel = `Annual ${selectedTier.charAt(0).toUpperCase()}${selectedTier.slice(1)} Support Package`;
    const formattedTier = formatCurrency(tierValue);

    cells[0].textContent = tierLabel;
    cells[1].textContent = "1";
    cells[2].textContent = formattedTier;
    cells[3].textContent = formattedTier;
    grandTotalElem.textContent = formatCurrency(newGrandTotal);
  }, [proposal, selectedTier]);

  useEffect(() => {
    if (!proposal) {
      return;
    }

    const container = document.getElementById("proposal-container");
    const tocList = document.getElementById("toc-list");
    if (!container || !tocList) {
      return;
    }

    updateProposalOutline(container, tocList);
    const frame = window.requestAnimationFrame(() => updateProposalOutline(container, tocList));

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [proposal, architectureHtml, componentsHtml, antennaPlacement]);

  useEffect(() => {
    if (!proposal) {
      return;
    }

    const downloadBtn = document.getElementById("download-pdf-btn") as HTMLButtonElement | null;
    if (!downloadBtn) {
      return;
    }

    const downloadNote = document.querySelector<HTMLElement>(".download-note");
    const runDownload = createPdfDownloadHandler({
      button: downloadBtn,
      note: downloadNote,
      computeFilename: () => computedTitle,
      slug,
    });

    const handleClick = () => {
      void runDownload();
    };

    downloadBtn.addEventListener("click", handleClick);
    return () => {
      downloadBtn.removeEventListener("click", handleClick);
    };
  }, [proposal, computedTitle, slug]);

  const getField = (key: string, fallback = ""): string => {
    if (!proposal) {
      return fallback;
    }
    return toDisplayString(proposal[key], fallback);
  };

  const hasProposal = Boolean(proposal);
  const introductionHtml = useMemo(() => {
    const stored = typeof introduction === "string" ? introduction.trim() : "";
    const base = stored || buildDefaultIntroduction(proposal);
    return base.replace(/\n/g, "<br />");
  }, [introduction, proposal]);

  return (
    <>
      <Head>
        <title>{computedTitle}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700&family=Montserrat:wght@600;700&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
          integrity="sha512-Yi7WUVw7Ck4S2tUGV3Q824ZjWvJ1i8xVqrodtk2fe8HPD+b1GaajLqU+S73UJeBB+vSiHbAf8KDGy6dCyYem0A=="
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
      </Head>

      <div className="proposal-root">
        {!hasProposal || error ? (
          <div className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
            <h1 className="text-3xl font-semibold text-slate-800">Interactive Proposal</h1>
            <p className="mt-2 text-sm text-slate-600">Slug: {slug}</p>
            <div className="mt-6 rounded-lg border border-slate-200 bg-white p-8 shadow">
              {error ? (
                <>
                  <p className="text-lg font-medium text-red-600">{error}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    Ensure the proposal was saved from the Cost Model using the “Save Proposal” action.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium text-slate-700">Proposal data not found.</p>
                  <p className="mt-2 text-sm text-slate-600">
                    Save a new proposal from the Cost Model using the “Save Proposal” action.
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div id="proposal-container">
            <div className="page cover-page">
              <img className="cover-logo" src="/images/uctel_logo.png" alt="UCtel Logo" />
              <div className="cover-title">
                Budgetary CEL-FI {getField("Solution", "Solution")}
                <span className="cover-title-intro">proposal for</span>
                {getField("Account", getField("CustomerName", ""))}
              </div>
            </div>

            <div className="page toc-page">
              <div className="header">
                <img src="/images/uctel_logo.png" alt="UCtel Logo" />
              </div>
              <h2 className="no-number">CONTENTS</h2>
              <ul className="toc" id="toc-list"></ul>
              <div className="footer">
                <div className="footer-info">
                  <img src="/images/uctel_logo.png" alt="UCtel Logo" className="footer-logo" />
                  <div className="footer-text">
                    <span>CEL-FI {getField("Solution", "Solution")} solution proposal for {getField("Account", "Customer")}</span>
                    <span>www.uctel.co.uk | sales@uctel.co.uk</span>
                  </div>
                </div>
                <div className="page-number"></div>
              </div>
            </div>

            <div className="page">
              <div className="header">
                <img src="/images/uctel_logo.png" alt="UCtel Logo" />
              </div>
              <h2>
                <i className="fa-solid fa-circle-info" /> Introduction
              </h2>
              <p dangerouslySetInnerHTML={{ __html: introductionHtml }} />
              <h3>About UCtel</h3>
              <p>UCtel specialises in the design, installation and management of in-building mobile signal systems.</p>
              <h4 className="no-number">Why UCtel:</h4>
              <ul>
                <li>We have been installing in building mobile signal systems since 2019 and have deployed over 300 systems in a wide range of buildings including private houses, offices, factories and hospitals</li>
                <li>We only work with equipment that complies with Ofcom’s UK Interface Requirement 2102</li>
                <li>We have developed our own survey tools which are tailored to the specific requirements of in-building signal boosters. This allows us to see the important information about the signals that matter to ensure the best result from the installation.</li>
                <li>We deploy 5G Stand Alone (Up to 4.0GHz) ready DAS solutions so that when 5G SA can be boosted, the DAS elements of the solution do not need to be upgraded.</li>
                <li>We provide a range of tailored support packages from break/fix maintenance to fully managed systems with onsite engineering support.</li>
              </ul>
              <h3>Key Contacts</h3>
              <p>The following team members are your <strong>primary points of contact</strong> for this proposal. We are here to answer any questions you may have.</p>
              <table id="key-contacts-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Title</th>
                    <th>Contact Details</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Ivor Nicholls</td>
                    <td>Sales Director</td>
                    <td>ivor.nicholls@uctel.co.uk</td>
                  </tr>
                  <tr>
                    <td>Ivan Romanov</td>
                    <td>Technical Director</td>
                    <td>ivan.romanov@uctel.co.uk</td>
                  </tr>
                </tbody>
              </table>
              <h3 className="confidentiality-heading" style={{ marginTop: "10mm" }}>
                Confidentiality
              </h3>
              <p>
                This document contains proprietary information and solution designs developed by UCtel. We present it to you <strong>in confidence</strong> and appreciate your discretion in handling the details of our proposal.
              </p>
              <div className="footer">
                <div className="footer-info">
                  <img src="/images/uctel_logo.png" alt="UCtel Logo" className="footer-logo" />
                  <div className="footer-text">
                    <span>CEL-FI {getField("Solution", "Solution")} solution proposal for {getField("Account", "Customer")}</span>
                    <span>www.uctel.co.uk | sales@uctel.co.uk</span>
                  </div>
                </div>
                <div className="page-number"></div>
              </div>
            </div>

            <div className="page">
              <div className="header">
                <img src="/images/uctel_logo.png" alt="UCtel Logo" />
              </div>
              <h2 className="proposed-solution">
                <i className="fa-solid fa-sitemap" /> Proposed Solution
              </h2>
              <div id="solution-architecture-section" dangerouslySetInnerHTML={{ __html: architectureHtml }} />
              <div className="footer">
                <div className="footer-info">
                  <img src="/images/uctel_logo.png" alt="UCtel Logo" className="footer-logo" />
                  <div className="footer-text">
                    <span>CEL-FI {getField("Solution", "Solution")} solution proposal for {getField("Account", "Customer")}</span>
                    <span>www.uctel.co.uk | sales@uctel.co.uk</span>
                  </div>
                </div>
                <div className="page-number"></div>
              </div>
            </div>

            {hasAntennaPlacement && (
              <div className="page antenna-page">
                <div className="header">
                  <img src="/images/uctel_logo.png" alt="UCtel Logo" />
                </div>
                <h2>
                  <i className="fa-solid fa-tower-cell" /> Provisional Antenna Placement
                </h2>
                <p>
                  This snapshot highlights the provisional antenna layout captured for {" "}
                  {antennaPlacement?.projectName ? <strong>{antennaPlacement.projectName}</strong> : "this project"}. It currently covers {formatCount(placementFloorCount)} {" "}
                  {placementFloorCount === 1 ? "floor" : "floors"} with {formatCount(placementAntennaCount)} antennas positioned across the building.
                </p>
                <div className="antenna-summary-grid">
                  <div className="antenna-summary-card">
                    <span className="antenna-summary-label">Source Project</span>
                    <span className="antenna-summary-value">{antennaPlacement?.projectName ?? "—"}</span>
                    {placementProjectUpdatedAt ? (
                      <span className="antenna-summary-sub">Updated {placementProjectUpdatedAt}</span>
                    ) : null}
                  </div>
                  <div className="antenna-summary-card">
                    <span className="antenna-summary-label">Snapshot Generated</span>
                    <span className="antenna-summary-value">{placementGeneratedAt ?? "—"}</span>
                    {placementGeneratedBy ? (
                      <span className="antenna-summary-sub">by {placementGeneratedBy}</span>
                    ) : null}
                  </div>
                  <div className="antenna-summary-card">
                    <span className="antenna-summary-label">Floors Analysed</span>
                    <span className="antenna-summary-value">{formatCount(placementFloorCount)}</span>
                    <span className="antenna-summary-sub">
                      {placementFloorCount === 1 ? "Single floor coverage" : "Multi-floor footprint"}
                    </span>
                  </div>
                  <div className="antenna-summary-card">
                    <span className="antenna-summary-label">Antennas</span>
                    <span className="antenna-summary-value">{formatCount(placementAntennaCount)}</span>
                  </div>
                  <div className="antenna-summary-card">
                    <span className="antenna-summary-label">Measured Coverage</span>
                    <span className="antenna-summary-value">{placementAreaLabel}</span>
                  </div>
                </div>
                {hasPlacementNotes ? (
                  <div className="antenna-notes">
                    <span className="antenna-stat-label">Notes</span>
                    <p>{placementNotes}</p>
                  </div>
                ) : null}
                {placementFloors.map((floor) => {
                  const coveragePolygons = (floor.coveragePolygons ?? []).filter(
                    (polygon): polygon is AntennaPlacementCoveragePolygon =>
                      Boolean(polygon) &&
                      Array.isArray(polygon.points) &&
                      polygon.points.length >= 3,
                  );

                  const coveragePaths = coveragePolygons
                    .map((polygon) => coveragePolygonToPath(polygon.points))
                    .filter((path) => path.length > 0);

                  const resolvedCoverageBounds =
                    (isValidCoverageBounds(floor.coverageBounds) ? floor.coverageBounds : null) ??
                    computeCoverageBoundsFromPolygons(coveragePolygons);

                  const zoomStyle = computeFloorplanZoomStyle(
                    floor.antennas,
                    resolvedCoverageBounds ?? undefined,
                  );

                  const sanitizedFloorId = floor.floorId.replace(/[^a-zA-Z0-9_-]/g, "-");
                  const coverageMaskId = `coverage-mask-${sanitizedFloorId}`;
                  const hasCoverageOverlay = coveragePaths.length > 0;

                  const validFloorAntennas = floor.antennas.filter(
                    (antenna): antenna is AntennaPlacementAntenna =>
                      Boolean(antenna) && isFiniteNumber(antenna.x) && isFiniteNumber(antenna.y),
                  );

                  const sanitizedAntennas = validFloorAntennas.map((antenna) => ({
                    ...antenna,
                    x: clamp(antenna.x, 0, 1),
                    y: clamp(antenna.y, 0, 1),
                  }));

                  const antennasWithinCoverage = hasCoverageOverlay
                    ? sanitizedAntennas.filter((antenna) =>
                        isPointInsideCoverage({ x: antenna.x, y: antenna.y }, coveragePolygons),
                      )
                    : sanitizedAntennas;

                  const visibleAntennas = sanitizedAntennas;
                  const hasAnyAntennas = sanitizedAntennas.length > 0;
                  const showCoverageWarning = hasCoverageOverlay && hasAnyAntennas && antennasWithinCoverage.length === 0;
                  const emptyStateMessage = !hasAnyAntennas
                    ? "No antennas have been plotted yet"
                    : showCoverageWarning
                      ? "No antennas inside the mapped coverage area yet"
                      : null;
                  const shouldShowEmptyState = Boolean(emptyStateMessage);

                  const rangeLabel =
                    floor.stats.antennaRange && floor.stats.antennaRange > 0
                      ? formatLengthValue(floor.stats.antennaRange, floor.stats.units)
                      : null;

                  return (
                    <div key={floor.floorId} className="antenna-floor">
                      <h3>{floor.floorName}</h3>
                      <div className="antenna-floor-card">
                        <div className="floorplan-container">
                          {floor.imageUrl ? (
                            <div className="floorplan-wrapper">
                              <div className="floorplan-zoom-layer">
                                <div className="floorplan-zoom-inner" style={zoomStyle}>
                                  <div className="floorplan-image-layer">
                                    <img
                                      src={floor.imageUrl}
                                      alt={`${floor.floorName} provisional antenna placement`}
                                    />
                                    {hasCoverageOverlay ? (
                                      <svg
                                        className="floorplan-coverage-layer"
                                        viewBox="0 0 1 1"
                                        preserveAspectRatio="none"
                                      >
                                        <defs>
                                          <mask id={coverageMaskId} maskUnits="objectBoundingBox">
                                            <rect x="0" y="0" width="1" height="1" fill="white" />
                                            {coveragePaths.map((pathD, pathIndex) => (
                                              <path key={`${coverageMaskId}-mask-${pathIndex}`} d={pathD} fill="black" />
                                            ))}
                                          </mask>
                                        </defs>
                                        <rect
                                          x="0"
                                          y="0"
                                          width="1"
                                          height="1"
                                          fill="#fdfdfd"
                                          fillOpacity={0.94}
                                          mask={`url(#${coverageMaskId})`}
                                        />
                                        {coveragePaths.map((pathD, pathIndex) => (
                                          <path
                                            key={`${coverageMaskId}-fill-${pathIndex}`}
                                            d={pathD}
                                            fill="none"
                                            stroke="rgba(70, 70, 70, 0.55)"
                                            strokeWidth={0.0025}
                                            strokeLinejoin="round"
                                          />
                                        ))}
                                      </svg>
                                    ) : null}
                                  </div>
                                  <div className="antenna-markers">
                                    {visibleAntennas.map((antenna, antennaIndex) => (
                                      <div
                                        key={antenna.id || `${floor.floorId}-antenna-${antennaIndex}`}
                                        className="antenna-marker is-pulsing"
                                        style={{ left: `${antenna.x * 100}%`, top: `${antenna.y * 100}%` }}
                                        title={`Antenna ${antennaIndex + 1}`}
                                        aria-hidden="true"
                                      >
                                        <span className="antenna-marker-core" />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                              {shouldShowEmptyState && emptyStateMessage ? (
                                <div className="antenna-marker-empty">{emptyStateMessage}</div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="floorplan-placeholder">Floorplan preview not available</div>
                          )}
                        </div>
                        <div className="antenna-floor-details">
                          <div className="antenna-floor-stats">
                            <div className="antenna-floor-stat">
                              <span className="antenna-stat-label">Antennas Placed</span>
                              <span className="antenna-stat-value">
                                  {formatCount(floor.stats.antennaCount)}
                              </span>
                            </div>
                            <div className="antenna-floor-stat">
                              <span className="antenna-stat-label">Measured Coverage</span>
                              <span className="antenna-stat-value">
                                {formatAreaValue(floor.stats.totalArea, floor.stats.units)}
                              </span>
                            </div>
                            {rangeLabel ? (
                              <div className="antenna-floor-stat">
                                <span className="antenna-stat-label">Typical Radius</span>
                                <span className="antenna-stat-value">{rangeLabel}</span>
                              </div>
                            ) : null}
                          </div>
                          {floor.stats.areaSummaries.length ? (
                            <div className="antenna-area-breakdown">
                              <span className="antenna-stat-label">Coverage Breakdown</span>
                              <ul className="antenna-area-list">
                                {floor.stats.areaSummaries.map((area) => (
                                  <li key={area.id}>
                                    <span>{area.label}</span>
                                    <span>{formatAreaValue(area.area, floor.stats.units)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {shouldShowEmptyState && emptyStateMessage ? (
                            <p className="antenna-floor-empty">{emptyStateMessage}.</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="footer">
                  <div className="footer-info">
                    <img src="/images/uctel_logo.png" alt="UCtel Logo" className="footer-logo" />
                    <div className="footer-text">
                      <span>CEL-FI {getField("Solution", "Solution")} solution proposal for {getField("Account", "Customer")}</span>
                      <span>www.uctel.co.uk | sales@uctel.co.uk</span>
                    </div>
                  </div>
                  <div className="page-number"></div>
                </div>
              </div>
            )}

            <div className="page" id="components-page">
              <div className="header">
                <img src="/images/uctel_logo.png" alt="UCtel Logo" />
              </div>
              <h2>Solution Components</h2>
              <div id="solution-components-section" dangerouslySetInnerHTML={{ __html: componentsHtml }} />
              <div className="footer">
                <div className="footer-info">
                  <img src="/images/uctel_logo.png" alt="UCtel Logo" className="footer-logo" />
                  <div className="footer-text">
                    <span>CEL-FI {getField("Solution", "Solution")} solution proposal for {getField("Account", "Customer")}</span>
                    <span>www.uctel.co.uk | sales@uctel.co.uk</span>
                  </div>
                </div>
                <div className="page-number"></div>
              </div>
            </div>

            <div className="page">
              <div className="header">
                <img src="/images/uctel_logo.png" alt="UCtel Logo" />
              </div>
              <h2>5G Ready Infrastructure</h2>
              <img src="/images/5g_ready_graphic_wide.png" alt="5G Ready Future-Proof Infrastructure" />
              <div className="feature-box">
                <h3>Future-Proof Your Investment</h3>
                <p>
                  All passive components in our Distributed Antenna System (DAS)—including donor antennas, server antennas, cabling, and splitters—are specified to support frequencies up to 4.0GHz. This ensures they are fully compatible with the 3.5GHz to 3.7GHz range (Band n78) allocated for 5G services in the UK.
                </p>
                <p>
                  While current Ofcom regulations do not yet permit the boosting of these 5G frequencies, your infrastructure will be ready from day one. When the regulations are updated, the core DAS network we install will not need to be replaced, saving you significant future expense and disruption.
                </p>
              </div>
              <h3>Key Benefits at a Glance</h3>
              <ul className="benefits-list">
                <li>
                  <strong>Investment Protection:</strong> Your in-building mobile infrastructure is future-proofed, ready for the next generation of mobile technology.
                </li>
                <li>
                  <strong>Significant Cost Savings:</strong> Avoid the high cost and disruption of a “rip-and-replace” upgrade when 5G boosting is enabled.
                </li>
                <li>
                  <strong>Seamless Transition:</strong> Be ready to take immediate advantage of 5G’s speed and capacity as soon as it’s available for boosting, with no additional hardware installation required.
                </li>
              </ul>
              <div className="footer">
                <div className="footer-info">
                  <img src="/images/uctel_logo.png" alt="UCtel Logo" className="footer-logo" />
                  <div className="footer-text">
                    <span>CEL-FI {getField("Solution", "Solution")} solution proposal for {getField("Account", "Customer")}</span>
                    <span>www.uctel.co.uk | sales@uctel.co.uk</span>
                  </div>
                </div>
                <div className="page-number"></div>
              </div>
            </div>

            <div className="page">
              <div className="header">
                <img src="/images/uctel_logo.png" alt="UCtel Logo" />
              </div>
              <h2>
                <i className="fa-solid fa-gears" /> Design and Installation Process
              </h2>
              <h3>Site Survey</h3>
              <p>In order to validate the assumptions in this proposal, a site survey is required. The survey will determine:</p>
              <ul>
                <li>Signal strength and quality inside the building to identify where coverage is needed.</li>
                <li>Potential locations to install the donor antennas. In these locations, measurements will be taken of the signal strength, quality and available frequency bands.</li>
                <li>The type and quantity of donor antennas required</li>
                <li>Cable routes from the donor antenna to the Network Unit(s)</li>
                <li>Cable routes from the boosters to the server antennas and/or coverage units</li>
                <li>Power locations and quantities</li>
                <li>Other factors associated with the installation such as access equipment required, risks and working hours.</li>
                <li>Final solution and price</li>
              </ul>
              <h3>Report and Quotation</h3>
              <p>
                Following the survey, a report will be provided which will include the results of the signal survey as well as details of the solution and proposed equipment locations. A formal quotation will be provided for the installation of the solution.
              </p>
              <h3>Project Coordination</h3>
              <p>
                Once the order for the solution has been received, UCtel will introduce a project coordinator to manage the installation process. The project coordinator will be responsible for communicating dates, arranging any required risk assessments, method statements and permits and ensuring the smooth delivery of the project.
              </p>
              <h3>Documentation</h3>
              <p>
                Once the installation is complete, the project coordinator will produce the final as-built documentation and post installation survey document. A project completion sign off will be requested to confirm acceptance of the installation and that all deliverables have been completed.
              </p>
              <div style={{ pageBreakAfter: "always", breakAfter: "page", height: "1px", overflow: "hidden" }}>&nbsp;</div>
              <div className="footer">
                <div className="footer-info">
                  <img src="/images/uctel_logo.png" alt="UCtel Logo" className="footer-logo" />
                  <div className="footer-text">
                    <span>CEL-FI {getField("Solution", "Solution")} solution proposal for {getField("Account", "Customer")}</span>
                    <span>www.uctel.co.uk | sales@uctel.co.uk</span>
                  </div>
                </div>
                <div className="page-number"></div>
              </div>
            </div>

            <div className="page">
              <div className="header">
                <img src="/images/uctel_logo.png" alt="UCtel Logo" />
              </div>
              <h2>
                <i className="fa-solid fa-sterling-sign" /> Proposed Pricing
              </h2>
              <p>The following table provides indicative figures for the proposed solution.</p>
              <table className="pricing-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Total Price</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{getField("Description1", "")}</td>
                    <td>{getField("Qty1", "")}</td>
                    <td>{getField("UnitPrice1", "")}</td>
                    <td>{getField("TotalPrice1", "")}</td>
                  </tr>
                  <tr>
                    <td>{getField("Description2", "")}</td>
                    <td>{getField("Qty2", "")}</td>
                    <td>{getField("UnitPrice2", "")}</td>
                    <td>{getField("TotalPrice2", "")}</td>
                  </tr>
                  <tr>
                    <td>{getField("Description3", "")}</td>
                    <td>{getField("Qty3", "")}</td>
                    <td>{getField("UnitPrice3", "")}</td>
                    <td>{getField("TotalPrice3", "")}</td>
                  </tr>
                  <tr id="support-row-initial">
                    <td>{getField("Description4", "Please see the support options below")}</td>
                    <td>{getField("Qty4", "")}</td>
                    <td>{getField("UnitPrice4", "")}</td>
                    <td>{getField("TotalPrice4", "")}</td>
                  </tr>
                  <tr className="total-row">
                    <td colSpan={3} style={{ textAlign: "right" }}>
                      Total Price:
                    </td>
                    <td id="grand-total-price">{getField("TotalPrice", "")}</td>
                  </tr>
                </tbody>
              </table>
              <p>
                The following support options are available. Please see the <a href="#section-cel-fi-support-services">CEL-FI Support Services</a> section for more details.
              </p>
              <table className="pricing-table">
                <thead>
                  <tr>
                    <th>Support Option</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Total Price</th>
                  </tr>
                </thead>
                <tbody id="support-options-body">
                  <tr className={supportRowClass("bronze")} data-tier="bronze">
                    <td>{getField("Support1", "Bronze")}</td>
                    <td>{getField("SupportQty1", "1")}</td>
                    <td>{getField("SupportUnitPrice1", "")}</td>
                    <td>{getField("SupportTotalPrice1", "")}</td>
                  </tr>
                  <tr className={supportRowClass("silver")} data-tier="silver">
                    <td>{getField("Support2", "Silver")}</td>
                    <td>{getField("SupportQty2", "1")}</td>
                    <td>{getField("SupportUnitPrice2", "")}</td>
                    <td>{getField("SupportTotalPrice2", "")}</td>
                  </tr>
                  <tr className={supportRowClass("gold")} data-tier="gold">
                    <td>{getField("Support3", "Gold")}</td>
                    <td>{getField("SupportQty3", "1")}</td>
                    <td>{getField("SupportUnitPrice3", "")}</td>
                    <td>{getField("SupportTotalPrice3", "")}</td>
                  </tr>
                </tbody>
              </table>
              <p>All figures shown are exclusive of VAT.</p>
              <p>
                <b>Terms:</b> Cel-Fi equipment to be paid on order. Other elements to be invoiced on completion and paid within 30 days.
              </p>
              <h3>Survey</h3>
              <div className="survey-cta">
                <p>
                  The next step is a comprehensive site survey, which will allow us to <strong>finalise the system design</strong> and provide you with a fixed, formal quotation. This ensures the proposed solution is perfectly tailored to your building’s specific needs.
                </p>
                <p>
                  The price for the survey and report is <span className="survey-price">{getField("SurveyPrice", "")}</span>
                </p>
              </div>
              <div className="footer">
                <div className="footer-info">
                  <img src="/images/uctel_logo.png" alt="UCtel Logo" className="footer-logo" />
                  <div className="footer-text">
                    <span>CEL-FI {getField("Solution", "Solution")} solution proposal for {getField("Account", "Customer")}</span>
                    <span>www.uctel.co.uk | sales@uctel.co.uk</span>
                  </div>
                </div>
                <div className="page-number"></div>
              </div>
            </div>

            <div className="page">
              <div className="header">
                <img src="/images/uctel_logo.png" alt="UCtel Logo" />
              </div>
              <div id="section-cel-fi-support-services" className="support-table-block">
                <div className="support-table-core">
                  <h2>CEL-FI Support Services</h2>
                  <p>The table below describes the available services that UCtel provides for the ongoing support of CEL-FI installations.</p>
                </div>
                <table className="support-details-table">
                  <thead>
                    <tr>
                      <th>Included Services</th>
                      <th>Description</th>
                      <th>Bronze</th>
                      <th>Silver</th>
                      <th>Gold</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Health check</td>
                      <td>Scheduled on-site health check</td>
                      <td>O</td>
                      <td>O</td>
                      <td>O</td>
                    </tr>
                    <tr>
                      <td>Remote Monitoring</td>
                      <td>Alerts and events captured on the management portal</td>
                      <td>☐</td>
                      <td>✅</td>
                      <td>✅</td>
                    </tr>
                    <tr>
                      <td>Reactive Support</td>
                      <td>Customer identifies issue and reports to UCtel</td>
                      <td>✅</td>
                      <td>✅</td>
                      <td>✅</td>
                    </tr>
                    <tr>
                      <td>Proactive Alerting</td>
                      <td>Events and alerts received from management portal proactively investigated by UCtel</td>
                      <td>☐</td>
                      <td>✅</td>
                      <td>✅</td>
                    </tr>
                    <tr>
                      <td>Incident Management</td>
                      <td>Incident managed by UCtel via Email</td>
                      <td>✅</td>
                      <td>✅</td>
                      <td>✅</td>
                    </tr>
                    <tr>
                      <td>Change Management *</td>
                      <td>Remote changes (eg change in network operator where antenna does not need to be adjusted)</td>
                      <td>☐</td>
                      <td>✅</td>
                      <td>✅</td>
                    </tr>
                    <tr>
                      <td>On-site support</td>
                      <td>Engineer to site for equipment relocation or antenna repositioning</td>
                      <td>☐</td>
                      <td>☐</td>
                      <td>✅</td>
                    </tr>
                    <tr>
                      <td>Service Reports</td>
                      <td>Quarterly service reporting</td>
                      <td>☐</td>
                      <td>☐</td>
                      <td>O</td>
                    </tr>
                    <tr>
                      <td>Service Review Meetings</td>
                      <td>Quarterly service review meetings</td>
                      <td>☐</td>
                      <td>☐</td>
                      <td>O</td>
                    </tr>
                    <tr>
                      <td>Maintenance (Parts only)</td>
                      <td>Break/Fix maintenance - parts to site</td>
                      <td>✅</td>
                      <td>✅</td>
                      <td>☐</td>
                    </tr>
                    <tr>
                      <td>Maintenance (with engineer)</td>
                      <td>Break / fix maintenance with engineer to site</td>
                      <td>☐</td>
                      <td>☐</td>
                      <td>✅</td>
                    </tr>
                  </tbody>
                </table>
                <p className="support-legend">✅ - included in service O – optional ☐ - not included * Up to 4 changes per year per system</p>
              </div>
              <p>
                <b>Notes:</b>
                <br />The services apply to remotely manageable CEL-FI products
                <br />Management connectivity is included via cellular connections and does not need to run over customer infrastructure
                <br />Proactive Alerting, Incident Management and Change Management operate in normal working hours unless agreed otherwise.
                <br />Services are subject to UCtel’s standard Terms and Conditions.
              </p>
              <div className="footer">
                <div className="footer-info">
                  <img src="/images/uctel_logo.png" alt="UCtel Logo" className="footer-logo" />
                  <div className="footer-text">
                    <span>CEL-FI {getField("Solution", "Solution")} solution proposal for {getField("Account", "Customer")}</span>
                    <span>www.uctel.co.uk | sales@uctel.co.uk</span>
                  </div>
                </div>
                <div className="page-number"></div>
              </div>
            </div>

            <div className="download-container">
              <button id="download-pdf-btn" className="download-btn" type="button">
                <i className="fa-solid fa-download" /> Download as PDF
              </button>
              <p className="download-note">Click to save this proposal as a PDF file</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
