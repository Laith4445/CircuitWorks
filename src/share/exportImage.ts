/** Export the schematic as SVG/PNG and a plot as PNG (students paste these into homework). */

function cssText(): string {
  let out = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try { for (const r of Array.from(sheet.cssRules)) out += r.cssText + '\n'; } catch { /* cross-origin */ }
  }
  return out;
}

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Serialise an SVG element with the page's styles inlined, optionally cropped to a viewBox. */
export function svgMarkup(svg: SVGSVGElement, viewBox?: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute('class');
  clone.removeAttribute('style');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (viewBox) clone.setAttribute('viewBox', viewBox);
  const [, , w, h] = (clone.getAttribute('viewBox') ?? '0 0 800 600').split(/\s+/).map(Number);
  clone.setAttribute('width', String(Math.round(w)));
  clone.setAttribute('height', String(Math.round(h)));
  // foreignObject (inline editor) can't be rasterised: drop it
  clone.querySelectorAll('foreignObject').forEach((n) => n.remove());
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = cssText() + '\nsvg{background:#fff}';
  clone.insertBefore(style, clone.firstChild);
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '-1e5'); bg.setAttribute('y', '-1e5'); bg.setAttribute('width', '2e5'); bg.setAttribute('height', '2e5'); bg.setAttribute('fill', '#fff');
  clone.insertBefore(bg, style.nextSibling);
  return new XMLSerializer().serializeToString(clone);
}

export function exportSvg(svg: SVGSVGElement, name: string, viewBox?: string): void {
  download(new Blob([svgMarkup(svg, viewBox)], { type: 'image/svg+xml' }), name);
}

export async function exportPng(svg: SVGSVGElement, name: string, viewBox?: string, scale = 2): Promise<void> {
  const markup = svgMarkup(svg, viewBox);
  const [, , w, h] = ((viewBox ?? svg.getAttribute('viewBox')) ?? '0 0 800 600').split(/\s+/).map(Number);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('could not render the image')); img.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (blob) download(blob, name);
}
