// AnnotationEngine — deterministic SVG overlays on original images.
//
// Model-generated regions arrive sanitized (normalized, clamped) from
// schema.ts. This module renders exact SVG overlays: numbered callouts,
// labels, arrows and highlights. SVG is generated server-side and escaped;
// model-provided label text never enters the document unescaped.

import type { SanitizedRegion } from "./schema";

const PALETTE = ["#20808d", "#d97706", "#7c3aed", "#dc2626", "#059669", "#2563eb"];

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type OverlayOptions = {
  width: number;
  height: number;
  regions: SanitizedRegion[];
  highlightIndex?: number | null;
  showLabels?: boolean;
};

// One region -> SVG group. Deterministic color from region index.
export function regionGroup(region: SanitizedRegion, index: number, opts: { width: number; height: number; highlighted: boolean; showLabels: boolean }): string {
  const [nx, ny, nw, nh] = region.bbox;
  const x = Math.round(nx * opts.width * 100) / 100;
  const y = Math.round(ny * opts.height * 100) / 100;
  const w = Math.round(nw * opts.width * 100) / 100;
  const h = Math.round(nh * opts.height * 100) / 100;
  const color = PALETTE[index % PALETTE.length];
  const uncertain = typeof region.confidence === "number" && region.confidence < 0.5;
  const stroke = uncertain ? `stroke="${color}" stroke-width="${opts.highlighted ? 4 : 2.5}" stroke-dasharray="8,5"` : `stroke="${color}" stroke-width="${opts.highlighted ? 4 : 2.5}"`;
  const fillOpacity = opts.highlighted ? 0.28 : 0.12;
  const label = escapeXml(region.label.length > 42 ? `${region.label.slice(0, 39)}…` : region.label);
  const badgeRadius = 11;
  const badgeX = x;
  const badgeY = y;
  const text = `<text x="${badgeX}" y="${badgeY + 4}" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="700" fill="#ffffff" text-anchor="middle">${index + 1}</text>`;
  if (!opts.showLabels) {
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" ${stroke} fill="${color}" fill-opacity="${fillOpacity}" rx="6"/>` +
      `<circle cx="${badgeX}" cy="${badgeY}" r="${badgeRadius}" fill="${color}"/>${text}</g>`;
  }
  // Label box width estimated from label length; clamped inside the canvas.
  const boxW = Math.min(Math.max(label.length * 7.2 + 18, 70), opts.width - x);
  const boxH = 26;
  const boxY = Math.max(0, y - boxH - 6) < y ? Math.max(0, y - boxH - 6) : Math.min(y + h + 6, opts.height - boxH);
  return `<g>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${stroke} fill="${color}" fill-opacity="${fillOpacity}" rx="6"/>` +
    `<rect x="${Math.min(badgeX, opts.width - boxW)}" y="${boxY}" width="${boxW}" height="${boxH}" fill="${color}" rx="6" opacity="0.94"/>` +
    `<text x="${Math.min(badgeX, opts.width - boxW) + 10}" y="${boxY + 18}" font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="600" fill="#ffffff">${label}</text>` +
    `<circle cx="${badgeX}" cy="${badgeY}" r="${badgeRadius}" fill="${color}"/>${text}</g>`;
}

// Full overlay SVG (viewBox matches image dims so it can be stacked on the
// original <img> in the UI, or exported standalone).
export function annotationOverlay(opts: OverlayOptions): string {
  const groups = opts.regions
    .map((region, i) => regionGroup(region, i, { width: opts.width, height: opts.height, highlighted: opts.highlightIndex === i, showLabels: opts.showLabels ?? true }))
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${opts.width} ${opts.height}" width="${opts.width}" height="${opts.height}">${groups}</svg>`;
}

// Arrow helper for diagrams: straight line + triangular head.
export function svgArrow(x1: number, y1: number, x2: number, y2: number, color: string, width = 2): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 10;
  const hx = x2 - headLen * Math.cos(angle);
  const hy = y2 - headLen * Math.sin(angle);
  const wing = 0.45;
  const p1x = x2, p1y = y2;
  const p2x = hx + headLen * Math.sin(angle) * wing, p2y = hy - headLen * Math.cos(angle) * wing;
  const p3x = hx - headLen * Math.sin(angle) * wing, p3y = hy + headLen * Math.cos(angle) * wing;
  return `<line x1="${x1}" y1="${y1}" x2="${hx}" y2="${hy}" stroke="${color}" stroke-width="${width}"/>` +
    `<polygon points="${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}" fill="${color}"/>`;
}
