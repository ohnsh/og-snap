/** Inputs are generated image data and a validated six-digit hex color. */
export function fitHtml(dataUrl: string, background: string) {
  return `<!doctype html><style>html,body{margin:0;width:1200px;height:630px;background:${background}}img{display:block;width:1200px;height:630px;object-fit:contain}</style><img src="${dataUrl}">`;
}
