export interface SocialMetadata {
  title: string;
  description: string;
  url: string;
  siteName?: string;
  type?: "website" | "article";
  image?: { url: string; width?: number; height?: number; alt?: string };
}
export type MetaTag = { property: string; content: string } | { name: string; content: string };

/** Framework-neutral descriptors; render with your framework's attribute escaping. */
export function socialMeta(input: SocialMetadata): MetaTag[] {
  const tags: MetaTag[] = [
    { property: "og:type", content: input.type ?? "website" },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:url", content: input.url },
    { name: "twitter:card", content: input.image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
  ];
  if (input.siteName !== undefined)
    tags.push({ property: "og:site_name", content: input.siteName });
  if (input.image) {
    const image = input.image;
    tags.push(
      { property: "og:image", content: image.url },
      { name: "twitter:image", content: image.url },
    );
    for (const name of ["width", "height", "alt"] as const) {
      if (image[name] !== undefined)
        tags.push({ property: `og:image:${name}`, content: String(image[name]) });
    }
    if (image.alt !== undefined) tags.push({ name: "twitter:image:alt", content: image.alt });
  }
  return tags;
}

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
/** For HTMLRewriter and other string-based consumers. */
export function renderMetaTags(tags: MetaTag[]): string {
  return tags
    .map((tag) =>
      "property" in tag
        ? `<meta property="${escape(tag.property)}" content="${escape(tag.content)}">`
        : `<meta name="${escape(tag.name)}" content="${escape(tag.content)}">`,
    )
    .join("\n");
}
