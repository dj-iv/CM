import { gunzipSync } from "node:zlib";

const INLINE_IMAGE_REGEX = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;

const guessMimeType = (urlPath: string, fallback = "application/octet-stream") => {
  if (!urlPath) {
    return fallback;
  }

  const cleanPath = urlPath.split("?")[0].split("#")[0];
  const extension = cleanPath.substring(cleanPath.lastIndexOf(".") + 1).toLowerCase();

  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "svg":
      return "image/svg+xml";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return fallback;
  }
};

const stripScripts = (input: string) => {
  let output = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  output = output.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return output;
};

const inlineRemoteImages = async (html: string, origin?: string) => {
  if (!origin) {
    return html;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[pdfShift] Invalid origin provided", origin, error);
    }
    return html;
  }

  const matches = [...html.matchAll(INLINE_IMAGE_REGEX)];
  if (!matches.length) {
    return html;
  }

  const replacements = new Map<string, string>();
  const uniqueSources = [...new Set(matches.map(([, src]) => src).filter(Boolean))];

  await Promise.all(
    uniqueSources.map(async (src) => {
      if (!src || src.startsWith("data:")) {
        return;
      }

      let absoluteUrl: string | null = null;
      try {
        if (src.startsWith("http://") || src.startsWith("https://")) {
          const candidate = new URL(src);
          if (candidate.host !== originUrl.host) {
            return;
          }
          absoluteUrl = candidate.href;
        } else {
          absoluteUrl = new URL(src, originUrl).href;
        }
      } catch (urlError) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[pdfShift] Skipping asset with invalid URL", src, urlError);
        }
        return;
      }

      if (!absoluteUrl) {
        return;
      }

      try {
        const response = await fetch(absoluteUrl);
        if (!response.ok) {
          return;
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get("content-type") || guessMimeType(absoluteUrl);
        const dataUri = `data:${contentType};base64,${buffer.toString("base64")}`;
        replacements.set(src, dataUri);
      } catch (fetchError) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[pdfShift] Failed to inline image", absoluteUrl, fetchError);
        }
        // Ignore fetch failures and leave src untouched
      }
    }),
  );

  if (!replacements.size) {
    return html;
  }

  return html.replace(INLINE_IMAGE_REGEX, (match, src) => {
    const replacement = replacements.get(src);
    if (!replacement) {
      return match;
    }
    return match.replace(src, replacement);
  });
};

const buildPayload = ({ html, css, options }: { html: string; css?: string | string[]; options?: Record<string, unknown> }) => {
  const payload: Record<string, unknown> = {
    source: html,
    sandbox: false,
  };

  if (css) {
    if (Array.isArray(css)) {
      payload.css = css
        .map((item) => {
          const isUrl = typeof item === "string" && /^(https?:)?\/\//i.test(item);
          return isUrl ? `@import url("${item}");` : String(item);
        })
        .join("\n");
    } else if (typeof css === "string") {
      const isUrl = /^(https?:)?\/\//i.test(css);
      payload.css = isUrl ? `@import url("${css}");` : css;
    }
  }

  if (options && typeof options === "object") {
    const {
      use_print,
      landscape,
      margin,
      margins,
      header,
      footer,
      wait,
      page_size,
      format,
    } = options as Record<string, unknown>;

    if (typeof use_print === "boolean") {
      payload.use_print = use_print;
    }

    if (typeof landscape === "boolean") {
      payload.landscape = landscape;
    }

    const resolvedFormat = typeof format === "string" ? format : page_size;
    if (typeof resolvedFormat === "string" && resolvedFormat.trim()) {
      payload.format = resolvedFormat.trim().toUpperCase();
    }

    const resolvedMargins = margin ?? margins;
    if (typeof resolvedMargins === "string") {
      payload.margin = resolvedMargins;
    } else if (resolvedMargins && typeof resolvedMargins === "object") {
      const { top, right, bottom, left } = resolvedMargins as Record<string, string>;
      const fallback = "0mm";
      const parts = [top, right, bottom, left].map((value) =>
        typeof value === "string" && value.trim() ? value.trim() : fallback,
      );
      payload.margin = parts.join(" ");
    }

    if (header && typeof header === "object") {
      payload.header = header;
    }

    if (footer && typeof footer === "object") {
      payload.footer = footer;
      if (!(payload.footer as Record<string, unknown>).height) {
        (payload.footer as Record<string, unknown>).height = "12mm";
      }
    }

    if (typeof wait === "number" && Number.isFinite(wait) && wait > 0) {
      payload.delay = Math.round(wait * 1000);
    }
  }

  return payload;
};

export interface PdfShiftRequest {
  html?: string;
  css?: string | string[];
  options?: Record<string, unknown>;
  filename?: string;
  encoding?: string;
  data?: string;
  origin?: string;
  debug?: boolean;
}

export class PdfShiftError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

export const convertWithPdfShift = async ({
  html,
  css,
  options,
  filename,
  encoding,
  data,
  origin,
  debug,
}: PdfShiftRequest): Promise<{ buffer: Buffer; filename: string }> => {
  const apiKey = process.env.PDFSHIFT_API_KEY;
  if (!apiKey) {
    throw new PdfShiftError("PDFShift API key is not configured", 500);
  }

  let htmlContent = html ?? "";

  if ((!htmlContent || !htmlContent.trim()) && typeof data === "string" && encoding === "gzip-base64") {
    try {
      htmlContent = gunzipSync(Buffer.from(data, "base64")).toString("utf8");
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[pdfShift] Failed to decompress HTML payload", error);
      }
      throw new PdfShiftError("Failed to decode compressed HTML payload", 400);
    }
  }

  if (!htmlContent || !htmlContent.trim()) {
    throw new PdfShiftError("Missing HTML content to convert", 400);
  }

  let sanitizedHtml = stripScripts(htmlContent);
  sanitizedHtml = await inlineRemoteImages(sanitizedHtml, origin);

  if (debug) {
    return { buffer: Buffer.from(sanitizedHtml, "utf8"), filename: (filename ?? "debug").concat(".html") };
  }

  const payload = buildPayload({ html: sanitizedHtml, css, options });

  const response = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMessage = "Failed to generate PDF via PDFShift.";
    let errorDetails: unknown;
    try {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text);
        errorDetails = parsed;
        if (parsed?.error) {
          errorMessage = parsed.error;
        } else if (parsed?.message) {
          errorMessage = parsed.message;
        }
      } catch (parseError) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[pdfShift] Failed to parse PDFShift error payload", parseError);
        }
        errorDetails = text;
      }
    } catch (readError) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[pdfShift] Failed to read PDFShift error response", readError);
      }
    }
    throw new PdfShiftError(errorMessage, response.status, errorDetails);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const safeFilename = (filename ?? "UCtel_Proposal").replace(/[^a-z0-9_-]+/gi, "_");

  return { buffer, filename: safeFilename };
};
