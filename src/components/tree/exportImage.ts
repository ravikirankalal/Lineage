import { CARD, type TreeLayout, type TreeNode } from '../../lib/graph/contract';
import { EDGE_STYLE } from './TreeEdges';

export interface ExportCard {
  name: string;
  line1?: string;
  line2?: string;
  initials: string;
  photo?: string;
  isFocus: boolean;
  isMe: boolean;
  badge?: string;
  /** Avatar background/foreground for initials. */
  colors: [string, string];
}

const PAD = 48;
const HEADER = 64;
const MAX_SIDE = 8000; // keep under browser canvas limits
const MAX_AREA = 36e6;

// Light palette (prints well), matching Avatar's PALETTE order.
export const AVATAR_COLORS: [string, string][] = [
  ['#ffe4e6', '#be123c'], ['#fef3c7', '#b45309'], ['#d1fae5', '#047857'], ['#e0f2fe', '#0369a1'],
  ['#ede9fe', '#6d28d9'], ['#ccfbf1', '#0f766e'], ['#ffedd5', '#c2410c'], ['#e0e7ff', '#4338ca'],
];
const EDGE_COLOR: Record<string, string> = { descent: '#a8a29e', marriage: '#4f9e85', divorced: '#a8a29e', step: '#f59e0b', collapse: '#a8a29e' };

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

/**
 * Draws the tree (edges and cards) onto a canvas and returns a PNG. Everything is drawn locally;
 * no DOM snapshotting library and no network. Always light theme so it prints and shares well.
 */
export async function renderTreePng(layout: TreeLayout, cardFor: (n: TreeNode) => ExportCard | undefined, title: string): Promise<Blob> {
  const { minX, maxX, minY, maxY } = layout.bounds;
  const w = maxX - minX + PAD * 2;
  const h = maxY - minY + PAD * 2 + HEADER;
  const scale = Math.max(0.5, Math.min(2, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h))));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';

  ctx.scale(scale, scale);
  ctx.fillStyle = '#fafaf9';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1c1917';
  ctx.font = `600 22px ${font}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(title, PAD, PAD / 2 + 18);
  ctx.fillStyle = '#78716c';
  ctx.font = `400 13px ${font}`;
  ctx.fillText(`Made with Lineage · ${new Date().toLocaleDateString()}`, PAD, PAD / 2 + 42);

  ctx.translate(PAD - minX, PAD + HEADER - minY);

  // Edges
  ctx.lineJoin = 'round';
  for (const e of layout.edges) {
    const s = EDGE_STYLE[e.kind];
    ctx.strokeStyle = EDGE_COLOR[e.kind];
    ctx.globalAlpha = s.opacity;
    ctx.lineWidth = s.width;
    ctx.lineCap = s.cap;
    ctx.setLineDash(s.dash ? s.dash.split(' ').map(Number) : []);
    ctx.beginPath();
    e.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // Photos load in parallel before drawing cards.
  const photos = new Map<string, HTMLImageElement | null>();
  const cards = layout.nodes.map((n) => [n, n.ghost ? undefined : cardFor(n)] as const);
  await Promise.all(cards.map(async ([n, c]) => { if (c?.photo) photos.set(n.key, await loadImage(c.photo)); }));

  for (const [n, c] of cards) {
    if (!c) continue;
    const x = n.x - CARD.w / 2;
    const y = n.y;
    const stub = !!n.dupOf;
    ctx.save();
    if (!stub) {
      ctx.shadowColor = 'rgba(0,0,0,0.08)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 1;
    }
    roundRect(ctx, x, y, CARD.w, CARD.h, 16);
    ctx.fillStyle = c.isFocus ? '#266955' : stub ? '#f5f5f4' : '#ffffff';
    ctx.fill();
    ctx.restore();
    roundRect(ctx, x, y, CARD.w, CARD.h, 16);
    ctx.setLineDash(stub ? [5, 4] : []);
    ctx.lineWidth = c.isMe && !c.isFocus ? 3 : stub ? 1.5 : 1;
    ctx.strokeStyle = c.isFocus ? '#266955' : c.isMe ? '#33826a' : '#d6d3d1';
    ctx.stroke();
    ctx.setLineDash([]);

    // Avatar
    const r = stub ? 15 : 20;
    const ax = x + 10 + r;
    const ay = y + CARD.h / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, ay, r, 0, Math.PI * 2);
    ctx.closePath();
    const img = photos.get(n.key);
    if (img) {
      ctx.clip();
      ctx.drawImage(img, ax - r, ay - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = c.colors[0];
      ctx.fill();
      ctx.fillStyle = c.colors[1];
      ctx.font = `600 ${Math.round(r * 0.75)}px ${font}`;
      ctx.textAlign = 'center';
      ctx.fillText(c.initials, ax, ay + 1);
    }
    ctx.restore();

    // Text
    const tx = ax + r + 10;
    const maxW = x + CARD.w - 10 - tx;
    const light = c.isFocus;
    ctx.textAlign = 'left';
    ctx.fillStyle = light ? '#ffffff' : '#1c1917';
    ctx.font = `600 14px ${font}`;
    const lines = [c.line1, c.line2].filter(Boolean) as string[];
    const top = ay - (lines.length * 15) / 2 - 1;
    ctx.fillText(fitText(ctx, c.name, maxW), tx, top);
    ctx.font = `400 12px ${font}`;
    lines.forEach((l, i) => {
      ctx.fillStyle = light ? 'rgba(255,255,255,0.85)' : i === 0 ? '#1f5446' : '#78716c';
      ctx.fillText(fitText(ctx, l, maxW), tx, top + 16 + i * 15);
    });

    if (c.isMe) {
      ctx.font = `700 10px ${font}`;
      const bw = ctx.measureText('ME').width + 14;
      roundRect(ctx, x - 8, y - 10, bw, 18, 9);
      ctx.fillStyle = '#33826a';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText('ME', x - 1, y - 1);
    }
    if (c.badge) {
      ctx.font = `600 9px ${font}`;
      const bw = ctx.measureText(c.badge.toUpperCase()).width + 10;
      roundRect(ctx, x + CARD.w - 12 - bw, y + CARD.h - 8, bw, 15, 7.5);
      ctx.fillStyle = '#fef3c7';
      ctx.fill();
      ctx.fillStyle = '#92400e';
      ctx.fillText(c.badge.toUpperCase(), x + CARD.w - 7 - bw, y + CARD.h - 0.5);
    }
  }

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image'))), 'image/png'));
}

/** Share the PNG with the Web Share API (files) where possible; otherwise download it. */
export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // Share failed (e.g. lost user activation): fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/** Same hash as Avatar, so the exported initials keep each person's colour. */
export function avatarColors(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
