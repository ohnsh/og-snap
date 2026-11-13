import { SnapError } from "./errors";
import type { ConsumerPolicy, Metadata, NormalizedCapture, Publication } from "./types";

export const validConsumer = (value: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
export const validKey = (value: string) =>
  value.length <= 240 && /^[a-zA-Z0-9_:-]+(?:\/[a-zA-Z0-9_:-]+)*$/.test(value);
export const validRequestId = (value: string) => /^[a-zA-Z0-9_-]{8,100}$/.test(value);
export const validRevision = (value: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

const invalid = (message: string): never => {
  throw new SnapError(400, "invalid_request", message);
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid("Expected a JSON object");
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid("Unknown request field");
}
function selector(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 300)
    return invalid(`${name} must be a CSS selector of 1–300 characters`);
  return value;
}
export function allowedCapture(url: URL, policy: ConsumerPolicy) {
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    policy.captureUrls.some((allowed) => {
      const target = new URL(allowed);
      return target.origin === url.origin && target.pathname === url.pathname;
    })
  );
}
function jsonDepth(value: unknown, depth = 0): boolean {
  if (depth > 16) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => jsonDepth(item, depth + 1));
  return (
    typeof value === "object" && Object.values(value!).every((item) => jsonDepth(item, depth + 1))
  );
}
export function normalizeCapture(input: unknown, policy: ConsumerPolicy): NormalizedCapture {
  const value = record(input);
  only(value, [
    "key",
    "url",
    "alt",
    "resolution",
    "selector",
    "readySelector",
    "errorSelector",
    "background",
    "metadata",
    "publication",
  ]);
  if (typeof value.key !== "string" || !validKey(value.key))
    invalid(
      "key must contain slash-separated letters, digits, underscores, colons or hyphens (maximum 240 characters)",
    );
  if (typeof value.url !== "string" || value.url.length > 4096)
    invalid("url is required (maximum 4096 characters)");
  let url: URL;
  try {
    url = new URL(value.url as string);
  } catch {
    return invalid("Invalid URL");
  }
  if (!allowedCapture(url, policy))
    throw new SnapError(
      403,
      "url_not_allowed",
      "This capture URL is not configured for the consumer",
    );
  url.hash = "";
  if (value.alt !== undefined && (typeof value.alt !== "string" || value.alt.length > 500))
    invalid("alt must be a string of at most 500 characters");
  const resolution =
    value.resolution === undefined ? { width: 1200, height: 865 } : record(value.resolution);
  only(resolution, ["width", "height"]);
  const { width, height } = resolution;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 320 ||
    width > 3840 ||
    height < 180 ||
    height > 2160
  )
    invalid("resolution requires integer width 320–3840 and height 180–2160");
  const background = value.background ?? "#202020";
  if (typeof background !== "string" || !/^#[0-9a-fA-F]{6}$/.test(background))
    invalid("background must be #RRGGBB");
  const metadata = value.metadata === undefined ? {} : record(value.metadata);
  if (!jsonDepth(metadata) || new TextEncoder().encode(JSON.stringify(metadata)).length > 16384)
    invalid("metadata must be JSON, at most 16 KiB and 16 levels deep");
  const publication =
    value.publication === undefined ? { mode: "create" } : record(value.publication);
  only(publication, publication.mode === "replace" ? ["mode", "expectedRevision"] : ["mode"]);
  if (!["create", "replace", "force"].includes(String(publication.mode)))
    invalid("publication.mode must be create, replace, or force");
  if (
    publication.mode === "replace" &&
    (typeof publication.expectedRevision !== "string" ||
      !validRevision(publication.expectedRevision))
  )
    invalid("replace requires expectedRevision");
  return {
    key: value.key as string,
    url: url.href,
    ...(value.alt !== undefined ? { alt: value.alt as string } : {}),
    resolution: { width: width as number, height: height as number },
    background: background as string,
    readySelector: selector(value.readySelector ?? '[data-og-ready="true"]', "readySelector"),
    ...(value.selector !== undefined ? { selector: selector(value.selector, "selector") } : {}),
    ...(value.errorSelector !== undefined
      ? { errorSelector: selector(value.errorSelector, "errorSelector") }
      : {}),
    metadata: metadata as Metadata,
    publication: publication as Publication,
  };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${canonicalJson(val)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export async function fingerprint(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
