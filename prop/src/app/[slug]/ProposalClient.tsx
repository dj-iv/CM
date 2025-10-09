"use client";

/* eslint-disable @next/next/no-page-custom-font */
/* eslint-disable @next/next/no-img-element */

import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { createPdfDownloadHandler } from "./pdfExport";
import type { DecodedProposal } from "./page";
import "./proposal.css";

type SupportTier = "bronze" | "silver" | "gold";

interface ProposalClientProps {
  slug: string;
  proposal: DecodedProposal | null;
  error: string | null;
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

export default function ProposalClient({ slug, proposal, error }: ProposalClientProps) {
  const [selectedTier, setSelectedTier] = useState<SupportTier | null>(null);
  const supportRowClass = (tier: SupportTier) =>
    selectedTier === tier ? "support-tier-option selected" : "support-tier-option";

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
  }, [proposal, architectureHtml, componentsHtml]);

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
                    Ensure the proposal was generated from the Cost Model using the “Proposal Temp” button.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium text-slate-700">Proposal data not found.</p>
                  <p className="mt-2 text-sm text-slate-600">
                    Generate a new proposal from the Cost Model using the “Proposal Temp” button.
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
              <p>
                UCtel is pleased to present this proposal to provide a comprehensive mobile signal solution for <strong>{getField("Account", "your organisation")}</strong>, designed to deliver reliable, high-quality indoor coverage for your staff and visitors. Coverage is required over {getField("NumberOfNetworks", "") || "—"} of the UK Mobile Network Operators (MNOs) – EE, O2, Vodafone and Three (3). Based on the information provided, UCtel proposes the use of the CEL-FI {getField("Solution", "Solution")} solution. This document sets out the details of the proposed solution, UCtel’s approach and budgetary pricing.
              </p>
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
