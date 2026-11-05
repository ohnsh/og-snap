import type { Manifest, Metadata } from "./types";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const dimensions = (value: unknown) =>
  object(value) &&
  Number.isInteger(value.width) &&
  Number.isInteger(value.height) &&
  Number(value.width) >= 320 &&
  Number(value.width) <= 3840 &&
  Number(value.height) >= 180 &&
  Number(value.height) <= 2160;

/** Validate the public wire contract and the requested manifest's identity. */
export function parseManifest<M extends Metadata = Metadata>(
  value: unknown,
  expected: { origin: string; consumer: string; key: string },
): Manifest<M> {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.consumer !== expected.consumer ||
    value.key !== expected.key ||
    typeof value.revision !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.revision) ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !object(value.image) ||
    value.image.width !== 1200 ||
    value.image.height !== 630 ||
    value.image.contentType !== "image/jpeg" ||
    value.image.url !== `${expected.origin}/images/${expected.consumer}/${value.revision}.jpg` ||
    (value.image.alt !== undefined &&
      (typeof value.image.alt !== "string" || value.image.alt.length > 500)) ||
    !object(value.capture) ||
    !dimensions(value.capture.resolution) ||
    !dimensions(value.capture.source) ||
    !object(value.metadata)
  ) {
    throw new Error("Invalid og-snap manifest");
  }
  return value as unknown as Manifest<M>;
}
