/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import { gzip } from "pako";

interface PdfDownloadContext {
  button: HTMLButtonElement;
  note: HTMLElement | null;
  computeFilename: () => string;
  slug: string;
  getViewerEmail?: () => string | null;
  isInternalViewer?: boolean;
}

export const createPdfDownloadHandler = ({ button, note, computeFilename, slug, getViewerEmail, isInternalViewer }: PdfDownloadContext) => {
  const originalButtonContent = button.innerHTML;
  const defaultNoteText = note?.textContent ?? "";

  const setLoadingState = (isLoading: boolean, noteText?: string) => {
    if (isLoading) {
      button.disabled = true;
      button.classList.add("is-loading");
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';
    } else {
      button.disabled = false;
      button.classList.remove("is-loading");
      button.innerHTML = originalButtonContent;
    }

    if (note) {
      note.textContent = noteText ?? defaultNoteText;
    }
  };

  const blobToDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const compressImageBlobToDataUrl = async (blob: Blob) => blobToDataUrl(blob);

  const waitForImages = async (root: Document) => {
    const images = Array.from(root.querySelectorAll("img"));
    await Promise.all(
      images.map((img) => {
        if (img.complete) {
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          img.onload = img.onerror = () => resolve();
        });
      }),
    );
  };

  const MM_TO_PX = 96 / 25.4;
  const mmToPx = (mm: number) => mm * MM_TO_PX;
  const PAGINATION_TOLERANCE = 2;
  const FOOTER_BUFFER = mmToPx(8);
  const MAX_QUEUE_STEPS = 2000;

  const createPageShell = (doc: Document, templatePage: HTMLElement, header: HTMLElement | null, footer: HTMLElement | null) => {
    const newPage = templatePage.cloneNode(false) as HTMLElement;
    newPage.removeAttribute("id");

    const headerClone = header ? (header.cloneNode(true) as HTMLElement) : null;
    const footerClone = footer ? (footer.cloneNode(true) as HTMLElement) : null;
    const pageBody = doc.createElement("div");
    pageBody.className = "page-body";

    if (headerClone) {
      newPage.appendChild(headerClone);
    }

    newPage.appendChild(pageBody);

    if (footerClone) {
      newPage.appendChild(footerClone);
    }

    return { page: newPage, body: pageBody };
  };

  const ensurePageBody = (doc: Document, page: HTMLElement, header: HTMLElement | null, footer: HTMLElement | null) => {
    let body = page.querySelector<HTMLElement>(".page-body");
    if (body) {
      return body;
    }

    body = doc.createElement("div");
    body.className = "page-body";

    const children = Array.from(page.children);
    children.forEach((child) => {
      if (child === header || child === footer) {
        return;
      }
      body.appendChild(child);
    });

    if (footer) {
      page.insertBefore(body, footer);
    } else {
      page.appendChild(body);
    }

    return body;
  };

  const hasMeaningfulContent = (body: HTMLElement | null) => {
    if (!body) {
      return false;
    }

    return Array.from(body.children).some((child) => {
      if (!(child instanceof HTMLElement)) {
        return Boolean(child.textContent?.trim());
      }

      if (child.classList.contains("force-page-break") || child.classList.contains("page-break")) {
        return false;
      }

      const textContent = child.textContent?.replace(/\s+/g, "");
      if (textContent) {
        return true;
      }

      return Boolean(
        child.querySelector(
          "img, svg, table, video, canvas, figure, ul, ol, li, p, h1, h2, h3, h4, h5, h6, .component-layout, .antenna-floor",
        ),
      );
    });
  };

  const removeEmptyPages = (doc: Document) => {
    const pages = Array.from(doc.querySelectorAll<HTMLElement>(".page"));

    let removed = 0;
    pages.forEach((page) => {
      if (page.classList.contains("cover-page")) {
        return;
      }

      const header = page.querySelector<HTMLElement>(".header");
      const footer = page.querySelector<HTMLElement>(".footer");
      const body = ensurePageBody(doc, page, header, footer);
      if (!body) {
        return;
      }

      if (hasMeaningfulContent(body)) {
        return;
      }

      page.parentNode?.removeChild(page);
      removed += 1;
    });

    return removed;
  };

  const applyInsetsToBody = (body: HTMLElement | null, topInset: number, bottomInset: number) => {
    if (!body) {
      return;
    }
    body.style.paddingTop = `${topInset || 0}px`;
    body.style.paddingBottom = `${bottomInset || 0}px`;
  };

  const getContentHeight = (body: HTMLElement | null) => {
    if (!body) {
      return 0;
    }
    const paddingTop = parseFloat(body.style.paddingTop) || 0;
    const paddingBottom = parseFloat(body.style.paddingBottom) || 0;
    return Math.max(0, body.scrollHeight - paddingTop - paddingBottom);
  };

  const computeMetrics = (view: Window, page: HTMLElement, header: HTMLElement | null, footer: HTMLElement | null) => {
    if (!view || !page) {
      return null;
    }

    const pageRect = page.getBoundingClientRect();
    const headerRect = header ? header.getBoundingClientRect() : null;
    const footerRect = footer ? footer.getBoundingClientRect() : null;
    const pageStyle = view.getComputedStyle(page);
    const paddingTop = parseFloat(pageStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(pageStyle.paddingBottom) || 0;

    const topInset = headerRect ? Math.max(paddingTop, headerRect.bottom - pageRect.top) : paddingTop;
    const bottomInsetRaw = footerRect ? Math.max(paddingBottom, pageRect.bottom - footerRect.top) : paddingBottom;
    const bottomInset = bottomInsetRaw + FOOTER_BUFFER;
    const availableHeight = Math.max(0, pageRect.height - topInset - bottomInset);

    return { pageRect, topInset, bottomInset, availableHeight };
  };

  const paginatePages = (doc: Document) => {
    const pages = Array.from(doc.querySelectorAll<HTMLElement>(".page"));
    const view = doc.defaultView;
    if (!view) {
      return false;
    }

    const queue: Array<{ page: HTMLElement; body: HTMLElement; header: HTMLElement | null; footer: HTMLElement | null }> = [];
    const processedCounts = new WeakMap<HTMLElement, number>();
    let queueSteps = 0;
    let didModify = false;

    const splitElementToFit = (element: Element, availableHeight: number) => {
      if (!element || element.nodeType !== 1) {
        return null;
      }

      if (!element.childNodes || !element.childNodes.length) {
        return null;
      }

      const UNSPLITTABLE_TAGS = new Set(["LI", "P", "H1", "H2", "H3", "H4", "H5", "H6", "IMG", "UL", "OL", "TABLE", "TR", "THEAD", "TBODY", "TFOOT"]);
      if (UNSPLITTABLE_TAGS.has(element.tagName)) {
        return null;
      }

      try {
        const cs = view.getComputedStyle(element as HTMLElement);
        const breakInside = (cs.getPropertyValue("break-inside") || cs.getPropertyValue("page-break-inside") || "").toLowerCase();
        const isAvoid = breakInside.includes("avoid");
        const isKnownBlock = (element as HTMLElement).classList.contains("component-layout") || (element as HTMLElement).classList.contains("arch-section") || (element as HTMLElement).classList.contains("support-table-core");
        if (isAvoid || isKnownBlock) {
          return null;
        }
      } catch (error) {
        // ignore
      }

      const initialStyle = view.getComputedStyle(element as HTMLElement);
      const initialMarginTop = parseFloat(initialStyle.marginTop) || 0;
      const initialMarginBottom = parseFloat(initialStyle.marginBottom) || 0;
      const initialHeight = (element as HTMLElement).getBoundingClientRect().height + initialMarginTop + initialMarginBottom;
      if (initialHeight <= availableHeight + PAGINATION_TOLERANCE) {
        return null;
      }

      const clone = element.cloneNode(false) as HTMLElement;
      const originalId = clone.id;
      if (originalId) {
        clone.removeAttribute("id");
      }

      const isWhitespace = (node: ChildNode) => node.nodeType === Node.TEXT_NODE && !node.textContent?.trim();
      const remeasure = () => {
        if (!element.childNodes.length) {
          return 0;
        }
        const currentStyle = view.getComputedStyle(element as HTMLElement);
        const marginTop = parseFloat(currentStyle.marginTop) || 0;
        const marginBottom = parseFloat(currentStyle.marginBottom) || 0;
        return (element as HTMLElement).getBoundingClientRect().height + marginTop + marginBottom;
      };

      let movedAny = false;

      while (element.childNodes.length) {
        let nodeToMove = element.lastChild as ChildNode | null;
        while (nodeToMove && isWhitespace(nodeToMove)) {
          element.removeChild(nodeToMove);
          nodeToMove = element.lastChild as ChildNode | null;
        }

        if (!nodeToMove) {
          break;
        }

        const movedNode = element.removeChild(nodeToMove);
        clone.insertBefore(movedNode, clone.firstChild);
        movedAny = true;

        const updatedHeight = remeasure();
        if (updatedHeight <= availableHeight + PAGINATION_TOLERANCE) {
          break;
        }
      }

      if (!movedAny || !clone.childNodes.length) {
        return null;
      }

      let originalRemoved = false;
      if (!element.childNodes.length) {
        if (element.parentNode) {
          element.parentNode.removeChild(element);
        }
        originalRemoved = true;
      }

      if (originalRemoved && originalId) {
        clone.id = originalId;
      }

      return { fragment: clone, originalRemoved };
    };

    pages.forEach((page) => {
      if (page.classList.contains("cover-page")) {
        return;
      }

      const header = page.querySelector<HTMLElement>(".header");
      const footer = page.querySelector<HTMLElement>(".footer");
      const body = ensurePageBody(doc, page, header, footer);
      if (!body) {
        return;
      }

      queue.push({ page, body, header, footer });
    });

    while (queue.length) {
      const ctx = queue.shift();
      if (!ctx) {
        break;
      }
      const { page, body, header, footer } = ctx;

      if (!body || !body.children.length) {
        if (page.parentNode) {
          page.parentNode.removeChild(page);
          didModify = true;
        }
        continue;
      }

      const attempts = processedCounts.get(page) || 0;
      if (attempts > 50) {
        continue;
      }
      processedCounts.set(page, attempts + 1);

      const metrics = computeMetrics(view, page, header, footer);
      if (!metrics) {
        continue;
      }
      applyInsetsToBody(body, metrics.topInset, metrics.bottomInset);

      const children = Array.from(body.children) as HTMLElement[];
      if (!children.length) {
        if (page.parentNode) {
          page.parentNode.removeChild(page);
          didModify = true;
        }
        continue;
      }

      let splitNode: HTMLElement | null = null;
      const forcedBreakNode = children.find((child, index) => {
        if (child.nodeType !== 1) {
          return false;
        }
        if (!child.classList.contains("force-page-break")) {
          return false;
        }
        return index > 0;
      });

      if (!forcedBreakNode && getContentHeight(body) <= metrics.availableHeight + PAGINATION_TOLERANCE) {
        continue;
      }

      if (forcedBreakNode) {
        splitNode = forcedBreakNode;
      }

      const contentBottom = metrics.pageRect.bottom - metrics.bottomInset;
      const firstElementChild = children.find((node) => node && node.nodeType === 1) || null;
      if (!splitNode) {
        for (let i = 0; i < children.length; i += 1) {
          const child = children[i];
          if (child.nodeType !== 1) {
            continue;
          }

          const childRect = child.getBoundingClientRect();
          const style = view.getComputedStyle(child);
          const marginBottom = parseFloat(style.marginBottom) || 0;
          const childBottom = childRect.bottom + marginBottom;

          if (childBottom <= contentBottom + PAGINATION_TOLERANCE) {
            continue;
          }

          const prev = child.previousElementSibling as HTMLElement | null;
          if (prev && /^H[1-6]$/i.test(prev.tagName)) {
            const isPrevFirst = firstElementChild && prev === firstElementChild;
            if (prev.textContent && prev.textContent.includes("Proposed Pricing")) {
              continue;
            }
            if (isPrevFirst) {
              splitNode = prev;
            } else {
              splitNode = prev;
            }
          } else {
            splitNode = child;
          }
          break;
        }
      }

      if (!splitNode || !splitNode.parentNode) {
        continue;
      }

      const firstChild = children.find((node) => node.nodeType === 1) || null;

      if (splitNode === firstChild) {
        const isHeading = splitNode.tagName && /^H[1-6]$/i.test(splitNode.tagName);
        if (!isHeading) {
          const style = view.getComputedStyle(splitNode);
          const totalHeight = splitNode.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
          const elementCount = children.filter((node) => node.nodeType === 1).length;
          if (totalHeight <= metrics.availableHeight + PAGINATION_TOLERANCE && elementCount !== 1) {
            splitNode = splitNode.nextElementSibling as HTMLElement | null;
            while (splitNode && splitNode.nodeType !== 1) {
              splitNode = splitNode.nextElementSibling as HTMLElement | null;
            }
            if (!splitNode) {
              continue;
            }
          }
        }
      }

      const { page: newPage, body: newBody } = createPageShell(doc, page, header, footer);
      const originalNextSibling = splitNode.nextSibling;
      let moveSplitNode = true;

      if (splitNode.nodeType === 1) {
        const overflowResult = splitElementToFit(splitNode, metrics.availableHeight);
        if (overflowResult && overflowResult.fragment) {
          newBody.appendChild(overflowResult.fragment);
          moveSplitNode = false;
        }
      }

      let cursor = moveSplitNode ? splitNode : splitNode.isConnected ? (splitNode.nextSibling as ChildNode | null) : (originalNextSibling as ChildNode | null);
      const nodesToMove: ChildNode[] = [];
      while (cursor) {
        const next = cursor.nextSibling;
        nodesToMove.push(cursor);
        cursor = next;
      }
      nodesToMove.forEach((node) => newBody.appendChild(node));

      if (page.parentNode) {
        page.parentNode.insertBefore(newPage, page.nextSibling);
        didModify = true;
      }

      const newHeader = newPage.querySelector<HTMLElement>(".header");
      const newFooter = newPage.querySelector<HTMLElement>(".footer");
      const newMetrics = computeMetrics(view, newPage, newHeader, newFooter);
      if (newMetrics) {
        applyInsetsToBody(newBody, newMetrics.topInset, newMetrics.bottomInset);
      }

      queue.push({ page: newPage, body: newBody, header: newHeader, footer: newFooter });

      if (!body.children.length) {
        if (page.parentNode) {
          page.parentNode.removeChild(page);
          didModify = true;
        }
      } else if (getContentHeight(body) > metrics.availableHeight + PAGINATION_TOLERANCE) {
        queue.push({ page, body, header, footer });
      }
      queueSteps += 1;
      if (queueSteps > MAX_QUEUE_STEPS) {
        break;
      }
    }

    if (enforceManualPageBreaks(doc)) {
      didModify = true;
    }

    return didModify;
  };

  const hasOverflow = (doc: Document) => {
    const pages = Array.from(doc.querySelectorAll<HTMLElement>(".page"));
    const view = doc.defaultView;
    if (!view) {
      return false;
    }

    return pages.some((page) => {
      if (page.classList.contains("cover-page")) {
        return false;
      }

      const header = page.querySelector<HTMLElement>(".header");
      const footer = page.querySelector<HTMLElement>(".footer");
      const body = ensurePageBody(doc, page, header, footer);
      if (!body) {
        return false;
      }

      const metrics = computeMetrics(view, page, header, footer);
      if (!metrics) {
        return false;
      }

      applyInsetsToBody(body, metrics.topInset, metrics.bottomInset);

      const usableBottom = metrics.pageRect.bottom - metrics.bottomInset;
      const elements = Array.from(body.children).filter((n) => n.nodeType === 1) as HTMLElement[];
      if (!elements.length) {
        return false;
      }
      const last = elements[elements.length - 1];
      const rect = last.getBoundingClientRect();
      const style = view.getComputedStyle(last);
      const marginBottom = parseFloat(style.marginBottom) || 0;
      const lastBottom = rect.bottom + marginBottom;
      if (lastBottom > usableBottom + PAGINATION_TOLERANCE) {
        return true;
      }

      const contentHeight = getContentHeight(body);
      return contentHeight > metrics.availableHeight + PAGINATION_TOLERANCE;
    });
  };

  const cleanupLonelyHeadings = () => {
    return;
  };

  const enforceManualPageBreaks = (doc: Document) => {
    const view = doc.defaultView;
    if (!view) {
      return false;
    }

    let modified = false;
    const pages = Array.from(doc.querySelectorAll<HTMLElement>(".page"));

    for (const page of pages) {
      if (page.classList.contains("cover-page")) {
        continue;
      }

      const header = page.querySelector<HTMLElement>(".header");
      const footer = page.querySelector<HTMLElement>(".footer");
      const body = ensurePageBody(doc, page, header, footer);
      if (!body) {
        continue;
      }

      const metrics = computeMetrics(view, page, header, footer);
      const elements = Array.from(body.children).filter((node) => node.nodeType === 1) as HTMLElement[];

      let breakIndex = -1;
      let breakElement: HTMLElement | null = null;
      let nestedBreakNode: HTMLElement | null = null;
      for (let i = 0; i < elements.length; i += 1) {
        const element = elements[i];
        const hasDirectBreak = element.classList && (element.classList.contains("force-page-break") || element.classList.contains("page-break"));
        if (hasDirectBreak) {
          breakIndex = i;
          breakElement = element;
          nestedBreakNode = element;
          break;
        }
        const nested = element.querySelector<HTMLElement>(".force-page-break, .page-break");
        if (nested) {
          breakIndex = i;
          breakElement = element;
          nestedBreakNode = nested;
          break;
        }
      }

      if (breakIndex !== -1 && breakElement) {
        const hasPreviousElements = elements.slice(0, breakIndex).some((node) => Boolean(node));
        let hasContentAbove = false;

        if (metrics) {
          const elementRect = breakElement.getBoundingClientRect();
          const desiredTop = metrics.pageRect.top + metrics.topInset;
          hasContentAbove = elementRect.top - desiredTop > PAGINATION_TOLERANCE;
        }

        if (!hasPreviousElements && !hasContentAbove) {
          continue;
        }

        const { page: newPage, body: newBody } = createPageShell(doc, page, header, footer);
        const newHeader = newPage.querySelector<HTMLElement>(".header");
        const newFooter = newPage.querySelector<HTMLElement>(".footer");

        if (nestedBreakNode && nestedBreakNode !== breakElement) {
          let splitChild: HTMLElement | null = nestedBreakNode;
          while (splitChild && splitChild.parentNode !== breakElement) {
            splitChild = splitChild.parentNode as HTMLElement | null;
          }

          const containerClone = breakElement.cloneNode(false) as HTMLElement;
          if (containerClone.id) {
            containerClone.removeAttribute("id");
          }

          let ptr: ChildNode | null = splitChild;
          while (ptr) {
            const next = ptr.nextSibling;
            containerClone.appendChild(ptr);
            ptr = next;
          }

          Array.from(containerClone.querySelectorAll(".force-page-break"))
            .forEach((el) => {
              const isMarkerOnly = !el.textContent?.trim() && el.children.length === 0;
              if (isMarkerOnly) {
                el.parentNode && el.parentNode.removeChild(el);
              } else {
                el.classList.remove("force-page-break");
              }
            });

          newBody.appendChild(containerClone);

          let sib = breakElement.nextSibling;
          while (sib) {
            const next = sib.nextSibling;
            newBody.appendChild(sib);
            sib = next;
          }

          if (!breakElement.firstChild) {
            breakElement.parentNode && breakElement.parentNode.removeChild(breakElement);
          }
        } else {
          const isMarkerOnly = !breakElement.textContent?.trim() && breakElement.children.length === 0;
          if (!isMarkerOnly) {
            newBody.appendChild(breakElement);
          } else if (breakElement.parentNode) {
            breakElement.parentNode.removeChild(breakElement);
          }
          let cursor = isMarkerOnly ? breakElement.nextSibling : breakElement.nextSibling;
          while (cursor) {
            const next = cursor.nextSibling;
            newBody.appendChild(cursor);
            cursor = next;
          }
        }

        if (page.parentNode) {
          page.parentNode.insertBefore(newPage, page.nextSibling);
        }

        const originalMetrics = metrics;
        if (originalMetrics) {
          applyInsetsToBody(body, originalMetrics.topInset, originalMetrics.bottomInset);
        }

        const newMetrics = computeMetrics(view, newPage, newHeader, newFooter);
        if (newMetrics) {
          applyInsetsToBody(newBody, newMetrics.topInset, newMetrics.bottomInset);
        }

        if (!body.children.length && page.parentNode) {
          page.parentNode.removeChild(page);
        }

        modified = true;
        break;
      }

      if (modified) {
        break;
      }
    }

    return modified;
  };

  const reflowTocPages = (doc: Document, tocEntries: Array<{ displayNumber: string; text: string; slug: string; level: string; pageElement: Element | null }>) => {
    const view = doc.defaultView;
    if (!view) {
      return [];
    }
    const tocPages = Array.from(doc.querySelectorAll<HTMLElement>(".page.toc-page"));
    if (!tocPages.length) {
      return [];
    }

    const templatePage = tocPages[0];
    const templateHeader = templatePage.querySelector<HTMLElement>(".header");
    const templateFooter = templatePage.querySelector<HTMLElement>(".footer");
    const templateBody = ensurePageBody(doc, templatePage, templateHeader, templateFooter);
    if (!templateBody) {
      return [];
    }

    const headingTemplate = templateBody.querySelector("h2");
    const tocList = templateBody.querySelector<HTMLUListElement>("ul.toc");
    if (!tocList) {
      return [];
    }

    for (let i = 1; i < tocPages.length; i += 1) {
      const page = tocPages[i];
      if (page.parentNode) {
        page.parentNode.removeChild(page);
      }
    }

    tocList.innerHTML = "";

    const entryNodes: Array<{ entry: any; pageNumberNode: HTMLElement | null }> = [];
    if (!tocEntries.length) {
      return entryNodes;
    }

    const headingBaseText = headingTemplate ? headingTemplate.textContent?.trim() ?? "" : "";
    const continuationHeadingText = headingBaseText ? `${headingBaseText} (CONTINUED)` : "";

    let currentPage = templatePage;
    let currentBody = templateBody;
    let currentHeader = templateHeader;
    let currentFooter = templateFooter;
    let currentList = tocList;
    let metrics = computeMetrics(view, currentPage, currentHeader, currentFooter);
    if (metrics) {
      applyInsetsToBody(currentBody, metrics.topInset, metrics.bottomInset);
    }

    const createContinuationPage = () => {
      const { page: newPage, body: newBody } = createPageShell(doc, templatePage, templateHeader, templateFooter);
      const newHeader = newPage.querySelector<HTMLElement>(".header");
      const newFooter = newPage.querySelector<HTMLElement>(".footer");

      if (headingTemplate && continuationHeadingText) {
        const headingClone = headingTemplate.cloneNode(true) as HTMLElement;
        headingClone.textContent = continuationHeadingText;
        newBody.appendChild(headingClone);
      }

      const newList = tocList.cloneNode(false) as HTMLUListElement;
      newList.removeAttribute("id");
      newBody.appendChild(newList);

      currentPage.parentNode?.insertBefore(newPage, currentPage.nextSibling);

      const newMetrics = computeMetrics(view, newPage, newHeader, newFooter);
      if (newMetrics) {
        applyInsetsToBody(newBody, newMetrics.topInset, newMetrics.bottomInset);
      }

      return { newPage, newBody, newHeader, newFooter, newList, newMetrics };
    };

    tocEntries.forEach((entry) => {
      const li = doc.createElement("li");
      li.className = entry.level === "H2" ? "toc-h2" : "toc-h3";

      const link = doc.createElement("a");
      link.href = `#${entry.slug}`;

      const titleSpan = doc.createElement("span");
      titleSpan.textContent = `${entry.displayNumber} ${entry.text}`;

      const pageSpan = doc.createElement("span");
      pageSpan.className = "toc-page-number";
      pageSpan.textContent = "";

      link.appendChild(titleSpan);
      link.appendChild(pageSpan);
      li.appendChild(link);

      currentList.appendChild(li);

      if (metrics && getContentHeight(currentBody) > metrics.availableHeight + PAGINATION_TOLERANCE) {
        currentList.removeChild(li);

        if (!currentList.children.length) {
          currentList.appendChild(li);
        } else {
          const created = createContinuationPage();
          currentPage = created.newPage;
          currentBody = created.newBody;
          currentHeader = created.newHeader;
          currentFooter = created.newFooter;
          currentList = created.newList;
          metrics = created.newMetrics;
          if (!metrics) {
            metrics = computeMetrics(view, currentPage, currentHeader, currentFooter);
            if (metrics) {
              applyInsetsToBody(currentBody, metrics.topInset, metrics.bottomInset);
            }
          }

          currentList.appendChild(li);
        }
      }

      entryNodes.push({ entry, pageNumberNode: pageSpan });
    });

    const extraPages = Array.from(doc.querySelectorAll<HTMLElement>(".page.toc-page")).slice(1);
    extraPages.forEach((page) => {
      const header = page.querySelector<HTMLElement>(".header");
      const footer = page.querySelector<HTMLElement>(".footer");
      const body = ensurePageBody(doc, page, header, footer);
      const list = body ? body.querySelector<HTMLElement>("ul.toc") : null;
      if (!list || !list.children.length) {
        if (page.parentNode) {
          page.parentNode.removeChild(page);
        }
      }
    });

    return entryNodes;
  };

  const refreshPageMetadata = (doc: Document) => {
    const assignPageNumbers = () => {
      const pages = Array.from(doc.querySelectorAll<HTMLElement>(".page:not(.cover-page)"));
      const hasCover = Boolean(doc.querySelector(".page.cover-page"));
      const baseNumber = hasCover ? 2 : 1;

      pages.forEach((page, index) => {
        const pageNumElem = page.querySelector<HTMLElement>(".footer .page-number");
        if (pageNumElem) {
          pageNumElem.textContent = String(index + baseNumber);
        }
      });

      return { pages, baseNumber };
    };

    doc.querySelectorAll(".heading-number").forEach((span) => span.remove());
    doc.querySelectorAll<HTMLElement>("[data-heading-number]").forEach((heading) => {
      heading.removeAttribute("data-heading-number");
    });

    let { pages, baseNumber } = assignPageNumbers();

    const headings = doc.querySelectorAll<HTMLElement>(
      ".page:not(.cover-page, .toc-page) h2:not(.no-number), .page:not(.cover-page, .toc-page) h3:not(.no-number)",
    );

    const tocEntries: Array<{ displayNumber: string; text: string; slug: string; level: string; pageElement: Element | null }> = [];
    let sectionCounter = 0;
    let subsectionCounter = 0;

    headings.forEach((heading) => {
      const rawText = heading.textContent?.trim() ?? "";
      let displayNumber;
      const numberSpan = doc.createElement("span");
      numberSpan.className = "heading-number";

      if (heading.tagName === "H2") {
        sectionCounter += 1;
        subsectionCounter = 0;
        displayNumber = `${sectionCounter}`;
      } else {
        subsectionCounter += 1;
        displayNumber = `${sectionCounter}.${subsectionCounter}`;
      }

      const headingText = rawText.replace(/^\d+(?:\.\d+)*\s+/, "");
      const slugBase = headingText ? headingText.toLowerCase().replace(/[^a-z0-9]+/g, "-") : displayNumber.replace(/\./g, "-");
      const slug = `section-${slugBase}`;
      heading.id = slug;

      numberSpan.textContent = `${displayNumber} `;
      heading.prepend(numberSpan);

      tocEntries.push({
        displayNumber,
        text: headingText,
        slug,
        level: heading.tagName,
        pageElement: heading.closest(".page"),
      });
    });

    const tocNodes = reflowTocPages(doc, tocEntries);

    ({ pages, baseNumber } = assignPageNumbers());

    tocNodes.forEach(({ entry, pageNumberNode }) => {
      if (!pageNumberNode) {
        return;
      }
      const pageNumber = entry.pageElement?.querySelector<HTMLElement>(".footer .page-number")?.textContent || "";
      pageNumberNode.textContent = pageNumber;
    });
  };

  const uint8ToBase64 = (bytes: Uint8Array) => {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const segment = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode.apply(null, segment as unknown as number[]);
    }
    return btoa(binary);
  };

  const compressHtmlToBase64 = (htmlString: string) => {
    const compressed = gzip(htmlString, { level: 6 });
    return {
      base64: uint8ToBase64(compressed),
      byteLength: compressed.length,
    };
  };

  const inlineImages = async (root: Document) => {
    const imageElements = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
    for (const img of imageElements) {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:") || src.startsWith("http")) {
        continue;
      }

      try {
        const absoluteUrl = img.src;
        const response = await fetch(absoluteUrl);
        if (!response.ok) {
          console.warn(`Failed to inline image: ${src}`);
          continue;
        }

        const blob = await response.blob();
        const optimizedDataUrl = await compressImageBlobToDataUrl(blob);
        img.setAttribute("src", optimizedDataUrl);
      } catch (error) {
        console.warn("Error inlining image", src, error);
      }
    }
  };

  const inlineStylesheets = async (root: Document) => {
    const links = Array.from(root.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
    for (const link of links) {
      const href = link.getAttribute("href");
      if (!href) {
        continue;
      }

      const isCrossOrigin = /^https?:\/\//i.test(href) && !href.startsWith(window.location.origin);
      if (isCrossOrigin || href.startsWith("data:")) {
        continue;
      }

      try {
        const absoluteUrl = new URL(href, window.location.origin).toString();
        const response = await fetch(absoluteUrl);
        if (!response.ok) {
          console.warn("[pdfExport] Failed to inline stylesheet", href, response.status);
          continue;
        }

        const cssText = await response.text();
        const styleEl = root.createElement("style");
        styleEl.setAttribute("data-inlined-from", href);
        styleEl.textContent = cssText;
        link.parentNode?.replaceChild(styleEl, link);
      } catch (error) {
        console.warn("[pdfExport] Error inlining stylesheet", href, error);
      }
    }

    const preloadLinks = Array.from(root.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="style"]'));
    preloadLinks.forEach((preload) => preload.remove());
  };

  const prepareHtmlForExport = async () => {
    const iframe = document.createElement("iframe");
    const pageWidthPx = mmToPx(210);
    const pageHeightPx = mmToPx(297);
    iframe.style.position = "fixed";
    iframe.style.left = "-9999px";
    iframe.style.top = "0";
    iframe.style.width = `${pageWidthPx}px`;
    iframe.style.height = `${pageHeightPx}px`;
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        throw new Error("Unable to access iframe document for PDF export.");
      }

      const clonedRoot = document.documentElement.cloneNode(true) as HTMLElement;

      const clonedBody = clonedRoot.querySelector("body");
      if (clonedBody) {
        clonedBody.classList.add("pdf-export");
        clonedBody.setAttribute("data-export-mode", "pdfshift");
      }

      const downloadContainer = clonedRoot.querySelector(".download-container");
      if (downloadContainer) {
        downloadContainer.remove();
      }

      clonedRoot.querySelectorAll(".proposal-viewer-banner").forEach((banner) => banner.remove());

      clonedRoot.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtu.be"]').forEach((embed) => {
        embed.remove();
      });

      clonedRoot.querySelectorAll("script").forEach((script) => script.remove());

      iframeDoc.open();
      iframeDoc.write("<!DOCTYPE html>" + clonedRoot.outerHTML);
      iframeDoc.close();

      await inlineStylesheets(iframeDoc);
      await waitForImages(iframeDoc);
      await inlineImages(iframeDoc);

      const balancePagination = async () => {
        const MAX_PASSES = 7;
        const MAX_MS = 5000;
        const start = iframe.contentWindow && iframe.contentWindow.performance
          ? iframe.contentWindow.performance.now()
          : Date.now();

        for (let pass = 0; pass < MAX_PASSES; pass += 1) {
          const modified = paginatePages(iframeDoc);
          cleanupLonelyHeadings(iframeDoc);
          refreshPageMetadata(iframeDoc);

          const elapsed = iframe.contentWindow && iframe.contentWindow.performance
            ? iframe.contentWindow.performance.now() - start
            : Date.now() - start;
          if (elapsed > MAX_MS) {
            break;
          }

          if (!modified && !hasOverflow(iframeDoc)) {
            break;
          }

          await new Promise((resolve) =>
            iframe.contentWindow && iframe.contentWindow.requestAnimationFrame
              ? iframe.contentWindow.requestAnimationFrame(() => resolve(undefined))
              : setTimeout(() => resolve(undefined), 0),
          );
        }

        refreshPageMetadata(iframeDoc);

        const ensureNoOverflow = async () => {
          const pages = Array.from(iframeDoc.querySelectorAll<HTMLElement>(".page"));
          const view = iframeDoc.defaultView;
          if (!view) return;

          const MAX_FORCED_MOVES = 12;
          let moves = 0;

          for (const page of pages) {
            if (moves >= MAX_FORCED_MOVES) break;
            if (page.classList.contains("cover-page")) continue;
            const header = page.querySelector<HTMLElement>(".header");
            const footer = page.querySelector<HTMLElement>(".footer");
            const body = ensurePageBody(iframeDoc, page, header, footer);
            if (!body) continue;

            const metrics = computeMetrics(view, page, header, footer);
            if (!metrics) continue;
            applyInsetsToBody(body, metrics.topInset, metrics.bottomInset);

            const fits = getContentHeight(body) <= metrics.availableHeight + PAGINATION_TOLERANCE;
            if (fits) continue;

            const children = Array.from(body.children).filter((el) => el && el.nodeType === 1) as HTMLElement[];
            const contentBottom = metrics.pageRect.bottom - metrics.bottomInset;
            let splitStart: HTMLElement | null = null;
            for (let i = 0; i < children.length; i += 1) {
              const child = children[i];
              const rect = child.getBoundingClientRect();
              const style = view.getComputedStyle(child);
              const marginBottom = parseFloat(style.marginBottom) || 0;
              const childBottom = rect.bottom + marginBottom;
              if (childBottom > contentBottom + PAGINATION_TOLERANCE) {
                splitStart = child;
                const prev = child.previousElementSibling as HTMLElement | null;
                const firstEl = children[0];
                if (prev && /^H[1-6]$/i.test(prev.tagName) && prev === firstEl) {
                  splitStart = prev;
                }
                break;
              }
            }

            if (!splitStart) {
              splitStart = children[children.length - 1] || null;
              if (splitStart && splitStart.classList.contains("footer")) {
                splitStart = splitStart.previousElementSibling as HTMLElement | null;
              }
            }

            if (!splitStart) continue;

            const { page: newPage, body: newBody } = createPageShell(iframeDoc, page, header, footer);
            const newHeader = newPage.querySelector<HTMLElement>(".header");
            const newFooter = newPage.querySelector<HTMLElement>(".footer");

            let node: ChildNode | null = splitStart;
            while (node) {
              const next = node.nextSibling;
              newBody.appendChild(node);
              node = next;
            }

            moves += 1;

            if (page.parentNode) {
              page.parentNode.insertBefore(newPage, page.nextSibling);
            }

            const m1 = computeMetrics(view, page, header, footer);
            if (m1) applyInsetsToBody(body, m1.topInset, m1.bottomInset);
            const m2 = computeMetrics(view, newPage, newHeader, newFooter);
            if (m2) applyInsetsToBody(newBody, m2.topInset, m2.bottomInset);

            if (!body.children.length && page.parentNode) {
              page.parentNode.removeChild(page);
            }

            await new Promise((resolve) =>
              iframe.contentWindow && iframe.contentWindow.requestAnimationFrame
                ? iframe.contentWindow.requestAnimationFrame(() => resolve(undefined))
                : setTimeout(() => resolve(undefined), 0),
            );

            if (moves >= MAX_FORCED_MOVES) break;
          }
        };

        if (hasOverflow(iframeDoc)) {
          await ensureNoOverflow();
          refreshPageMetadata(iframeDoc);
        }
      };

      await balancePagination();
      await inlineImages(iframeDoc);

      const removedPages = removeEmptyPages(iframeDoc);
      if (removedPages) {
        refreshPageMetadata(iframeDoc);
      }

      const serializedHtml = "<!DOCTYPE html>" + iframeDoc.documentElement.outerHTML;
      return serializedHtml;
    } finally {
      document.body.removeChild(iframe);
    }
  };

  return async () => {
    try {
      setLoadingState(true, "Generating PDF. This may take a few moments...");

      const html = await prepareHtmlForExport();
      const filenameBase = (computeFilename() || document.title || "UCtel_Proposal").replace(/[^a-z0-9_-]+/gi, "_");

      const rawByteLength = new TextEncoder().encode(html).length;
      console.info("PDF export raw payload size (bytes):", rawByteLength);

      let requestBody;
      try {
        const { base64, byteLength } = compressHtmlToBase64(html);
        console.info("PDF export compressed payload size (bytes):", byteLength);
        requestBody = {
          encoding: "gzip-base64",
          data: base64,
          filename: filenameBase,
          origin: window.location.origin,
          options: {
            page_size: "a4",
            use_print: false,
            margin: {
              top: "0mm",
              right: "0mm",
              bottom: "0mm",
              left: "0mm",
            },
            wait: 1,
          },
          diagnostics: {
            rawBytes: rawByteLength,
            compressedBytes: byteLength,
          },
        };
      } catch (compressionError) {
        console.error("Failed to compress HTML before sending to PDF service.", compressionError);
        throw new Error("Unable to compress proposal for PDF generation. Please refresh and try again.");
      }

      const response = await fetch(`/api/proposals/${encodeURIComponent(slug)}/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let errorMessage = "Failed to generate PDF via PDFShift.";
        try {
          const errorPayload = await response.json();
          if (errorPayload && errorPayload.error) {
            errorMessage = errorPayload.error;
          }
        } catch (parseError) {
          // ignore parse errors and use generic message
        }
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${filenameBase}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setLoadingState(false, "PDF downloaded successfully.");

      // Attempt to record a customer download event using the active viewer email (if allowed).
      try {
        if (!isInternalViewer) {
          const viewerEmail = getViewerEmail?.();
          const fallbackEmail = typeof window !== "undefined" ? window.localStorage.getItem("uctel_proposal_email") : null;
          const normalizedEmail = (viewerEmail ?? fallbackEmail)?.trim();
          if (normalizedEmail) {
            await fetch(`/api/proposals/${encodeURIComponent(slug)}/events`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "download", email: normalizedEmail }),
            });
          }
        }
      } catch (eventError) {
        console.warn("Failed to log proposal download event", eventError);
      }
    } catch (error) {
      console.error("PDF download failed", error);
      setLoadingState(false, "Failed to generate PDF. Please try again or contact support.");
    }
  };
};
