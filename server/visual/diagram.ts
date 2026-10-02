// DiagramGenerationService — deterministic SVG diagrams from validated specs.
//
// The vision model returns a structured DiagramSpec (schema.ts); this module
// lays it out deterministically (no LLM in the render path, no model HTML).
// Output is standalone, escaped SVG. Every diagram is labelled "Illustrative
// reconstruction — not an exact redraw" so users never mistake it for the
// original image.

import { svgArrow, escapeXml } from "./annotation";
import type { z } from "zod";
import type { DiagramSpec } from "./schema";

type Spec = z.infer<typeof DiagramSpec>;

const NODE_W = 150;
const NODE_H = 46;
const GAP_X = 60;
const GAP_Y = 44;
const MARGIN = 40;

export function diagramSvg(spec: Spec): string {
  const n = spec.nodes.length;
  const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n * 1.4));
  const rows = Math.ceil(n / cols);
  const width = Math.max(cols * (NODE_W + GAP_X) - GAP_X + MARGIN * 2, 320);
  const height = rows * (NODE_H + GAP_Y) - GAP_Y + MARGIN * 2 + 60;

  // Position nodes on a grid, keyed by node id.
  const pos = new Map<string, { x: number; y: number; cx: number; cy: number }>();
  spec.nodes.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (NODE_W + GAP_X);
    const y = MARGIN + 18 + row * (NODE_H + GAP_Y);
    pos.set(node.id, { x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 });
  });

  const shape = (node: { id: string; label: string; shape: "rect" | "diamond" | "circle" | "round" }, p: { x: number; y: number }): string => {
    const cx = p.x + NODE_W / 2;
    const cy = p.y + NODE_H / 2;
    const label = escapeXml(node.label.length > 26 ? `${node.label.slice(0, 24)}…` : node.label);
    const text = `<text x="${cx}" y="${cy + 5}" font-family="Inter, system-ui, sans-serif" font-size="13.5" font-weight="600" fill="#0f172a" text-anchor="middle">${label}</text>`;
    const stroke = `stroke="#20808d" stroke-width="2"`;
    if (node.shape === "circle") {
      return `<ellipse cx="${cx}" cy="${cy}" rx="${NODE_W / 2}" ry="${NODE_H / 2}" ${stroke} fill="#e6f4f5"/>${text}`;
    }
    if (node.shape === "diamond") {
      return `<polygon points="${cx},${p.y} ${p.x + NODE_W},${cy} ${cx},${p.y + NODE_H} ${p.x},${cy}" ${stroke} fill="#e6f4f5"/>${text}`;
    }
    if (node.shape === "round") {
      return `<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="22" ${stroke} fill="#e6f4f5"/>${text}`;
    }
    return `<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="8" ${stroke} fill="#e6f4f5"/>${text}`;
  };

  const nodeSvg = spec.nodes.map((node) => {
    const p = pos.get(node.id);
    return p ? shape(node, { x: p.x, y: p.y }) : "";
  }).join("\n");

  const edgeSvg = spec.edges
    .map((edge) => {
      const from = pos.get(edge.from);
      const to = pos.get(edge.to);
      if (!from || !to) return "";
      const sameRow = Math.abs(from.cy - to.cy) < 4;
      const vertical = !sameRow && Math.abs(from.cx - to.cx) < 4;
      let arrow: string;
      let labelSvg = "";
      if (sameRow) {
        const left = from.cx < to.cx ? from : to;
        const right = from.cx < to.cx ? to : from;
        arrow = svgArrow(left.x + NODE_W, left.cy, right.x, right.cy, "#0f766e");
        if (edge.label) {
          const mx = (left.x + NODE_W + right.x) / 2;
          labelSvg = `<text x="${mx}" y="${left.cy - 8}" font-family="Inter, system-ui, sans-serif" font-size="12" fill="#475569" text-anchor="middle">${escapeXml(edge.label.slice(0, 24))}</text>`;
        }
      } else if (vertical) {
        const top = from.cy < to.cy ? from : to;
        const bottom = from.cy < to.cy ? to : from;
        arrow = svgArrow(top.cx, top.y + NODE_H, bottom.cx, bottom.y, "#0f766e");
        if (edge.label) {
          const my = (top.y + NODE_H + bottom.y) / 2;
          labelSvg = `<text x="${top.cx + 8}" y="${my}" font-family="Inter, system-ui, sans-serif" font-size="12" fill="#475569">${escapeXml(edge.label.slice(0, 24))}</text>`;
        }
      } else {
        const dx = from.cx < to.cx ? 1 : -1;
        const dy = from.cy < to.cy ? 1 : -1;
        const sx = from.cx + (dx * NODE_W) / 2;
        const sy = from.cy + (dy * NODE_H) / 2;
        const ex = to.cx - (dx * NODE_W) / 2;
        const ey = to.cy - (dy * NODE_H) / 2;
        const midX = (sx + ex) / 2;
        const midY = sy;
        arrow = `<path d="M ${sx} ${sy} Q ${midX} ${midY} ${ex} ${ey}" fill="none" stroke="#0f766e" stroke-width="2"/>` +
          svgArrow(midX, sy + (ey > sy ? 0 : 0), ex, ey, "#0f766e");
        if (edge.label) {
          labelSvg = `<text x="${midX}" y="${midY - 8}" font-family="Inter, system-ui, sans-serif" font-size="12" fill="#475569" text-anchor="middle">${escapeXml(edge.label.slice(0, 24))}</text>`;
        }
      }
      return arrow + labelSvg;
    })
    .join("\n");

  const title = escapeXml(spec.title.slice(0, 80));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${title}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>` +
    `<text x="${MARGIN}" y="${MARGIN + 2}" font-family="Inter, system-ui, sans-serif" font-size="19" font-weight="700" fill="#0f172a">${title}</text>` +
    nodeSvg + edgeSvg +
    `<text x="${MARGIN}" y="${height - 18}" font-family="Inter, system-ui, sans-serif" font-size="11.5" fill="#94a3b8">Illustrative reconstruction generated from image content — not an exact redraw.</text>` +
    `</svg>`;
}

// Data URL form for direct <img src> embedding and downloads.
export function diagramSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
