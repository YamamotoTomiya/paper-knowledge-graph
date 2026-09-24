import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceCollide } from 'd3-force';
import {
  CATEGORIES, CATEGORY_TEXT_COLORS, ENTITY_COLOR, ENTITY_LABELS, RELATION_TYPE_COLOR, nodeKey,
} from '../data/graph.js';
import { buildEgoGraph } from '../flow/egoNetwork.js';
import { drawHoverLabel } from '../flow/canvasLabel.js';

// 全体マップ（GlobalMap）と同じcanvas1枚の力学グラフとして関係グラフ（エゴネットワーク）を
// 描く。以前はReact Flow（DOM/SVG）で描いていたが、ノード・エッジがDOM要素になる分
// 全体マップより動きが重く見える問題があったため、全体マップと同じreact-force-graph-2d
// （canvas描画・軽量）に統一した。
const HOVER_LABEL_MAX_EDGES = 8;

function kindLabelOf(node) {
  if (node.kind === 'paper') return 'この論文';
  return `この${ENTITY_LABELS[node.kind] ?? node.kind}`;
}

function nodeGeometry(node, hover) {
  if (node.isCenter) {
    const color = node.kind === 'paper' ? (CATEGORY_TEXT_COLORS[node.category] ?? '#0f172a') : '#0f172a';
    return { shape: 'circle', r: hover ? 12 : 10, color, fill: '#fff', lineWidth: 3 };
  }
  if (node.kind !== 'paper') {
    return { shape: 'square', s: hover ? 13 : 10, color: ENTITY_COLOR[node.kind] ?? '#94a3b8' };
  }
  const base = node.indirect ? 4.5 : 7;
  return {
    shape: 'circle',
    r: hover ? base * 1.6 : base,
    color: CATEGORY_TEXT_COLORS[node.category] ?? '#0369a1',
    fill: node.indirect ? 'transparent' : '#fff',
    dashed: !!node.indirect,
    lineWidth: node.indirect ? 1 : 1.7,
  };
}

function nodeLabelText(node) {
  if (node.isCenter) return `${kindLabelOf(node)}: ${node.label}`;
  if (node.kind !== 'paper') return `${ENTITY_LABELS[node.kind] ?? node.kind}: ${node.label}`;
  return node.indirect ? `類似論文の類似論文: ${node.label}` : node.label;
}

export default function EgoGraph({
  centerRef, maxNeighbors, selectedNodeId, onNodeClick, onNodeDoubleClick, onEdgeClick, onBackgroundClick, overlays,
}) {
  const fgRef = useRef(null);
  const wrapRef = useRef(null);
  const hoverRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoverNode, setHoverNode] = useState(null);
  const lastClickRef = useRef({ id: null, time: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    const resize = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () => buildEgoGraph(centerRef, { maxNeighbors }),
    [centerRef, maxNeighbors],
  );

  // ホバー中のノードがあればそれを、無ければ「クリックして選んだノード」を強調対象にする。
  // これによりクリックした後マウスを離してもハイライトが残り、詳細パネルを読みながら
  // どのノードの繋がりか確認できる（ホバーだけだとマウスを動かすと消えてしまうため）。
  const highlightId = hoverNode?.id ?? selectedNodeId ?? null;

  const connectedIds = useMemo(() => {
    if (!highlightId) return null;
    const set = new Set([highlightId]);
    for (const l of data.links) {
      const s = l.source.id ?? l.source;
      const t = l.target.id ?? l.target;
      if (s === highlightId) set.add(t);
      else if (t === highlightId) set.add(s);
    }
    return set;
  }, [highlightId, data]);

  const touchingEdgeCount = useMemo(() => {
    if (!highlightId) return 0;
    return data.links.filter((l) => (l.source.id ?? l.source) === highlightId || (l.target.id ?? l.target) === highlightId).length;
  }, [highlightId, data]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-140);
    fg.d3Force('link')?.distance((l) => (l.indirect ? 90 : 70)).strength(0.5);
    fg.d3Force('collide', forceCollide((n) => (n.isCenter ? 20 : n.kind !== 'paper' ? 14 : n.indirect ? 8 : 12)));
  }, [data]);

  const onEngineStop = useCallback(() => {
    fgRef.current?.zoomToFit(400, 40);
  }, []);

  const drawNode = useCallback((node, ctx, scale) => {
    const hover = node.id === hoverRef.current;
    const emphasized = highlightId === node.id;
    const dimmed = highlightId && connectedIds && !connectedIds.has(node.id);
    const geo = nodeGeometry(node, hover || emphasized);

    ctx.globalAlpha = dimmed ? 0.12 : 1;
    ctx.setLineDash(geo.dashed ? [3, 2] : []);
    if (geo.shape === 'square') {
      ctx.fillStyle = geo.color;
      ctx.fillRect(node.x - geo.s / 2, node.y - geo.s / 2, geo.s, geo.s);
    } else {
      ctx.beginPath();
      ctx.arc(node.x, node.y, geo.r, 0, Math.PI * 2);
      ctx.fillStyle = geo.fill ?? '#fff';
      ctx.fill();
      ctx.lineWidth = geo.lineWidth * (hover || emphasized ? 1.4 : 1);
      ctx.strokeStyle = geo.color;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    if (node.isCenter || hover || emphasized) {
      drawHoverLabel(ctx, node, (geo.r ?? geo.s / 2) + 5 / scale, scale, nodeLabelText(node));
    }
  }, [highlightId, connectedIds]);

  const paintPointerArea = useCallback((node, color, ctx) => {
    const hover = node.id === hoverRef.current;
    const geo = nodeGeometry(node, hover);
    ctx.fillStyle = color;
    if (geo.shape === 'square') {
      ctx.fillRect(node.x - geo.s / 2, node.y - geo.s / 2, geo.s, geo.s);
    } else {
      ctx.beginPath();
      ctx.arc(node.x, node.y, geo.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  const linkColor = useCallback((l) => {
    const s = l.source.id ?? l.source;
    const t = l.target.id ?? l.target;
    const touches = highlightId && (s === highlightId || t === highlightId);
    const base = RELATION_TYPE_COLOR[l.type] ?? '#64748b';
    if (highlightId) return touches ? base : 'rgba(148,163,184,0.04)';
    return `${base}${l.indirect ? '33' : '66'}`;
  }, [highlightId]);

  const linkWidth = useCallback((l) => {
    const s = l.source.id ?? l.source;
    const t = l.target.id ?? l.target;
    const touches = highlightId && (s === highlightId || t === highlightId);
    if (touches) return 2.2;
    return l.indirect ? 0.6 : 1.1;
  }, [highlightId]);

  const linkLineDash = useCallback((l) => (l.indirect ? [3, 2] : null), []);

  const linkCanvasObjectMode = useCallback(() => 'after', []);
  const linkCanvasObject = useCallback((l, ctx, scale) => {
    if (!highlightId || touchingEdgeCount === 0 || touchingEdgeCount > HOVER_LABEL_MAX_EDGES) return;
    const s = l.source.id ?? l.source;
    const t = l.target.id ?? l.target;
    if (s !== highlightId && t !== highlightId) return;
    if (typeof l.source !== 'object' || typeof l.target !== 'object') return;
    const midX = (l.source.x + l.target.x) / 2;
    const midY = (l.source.y + l.target.y) / 2;
    const label = `${l.typeJa}${l.scoreVal != null ? ` ${l.scoreVal.toFixed(2)}` : ''}`;
    ctx.font = `600 ${10 / scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 8 / scale;
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillRect(midX - w / 2, midY - 7 / scale, w, 14 / scale);
    ctx.fillStyle = '#0f172a';
    ctx.fillText(label, midX, midY);
  }, [highlightId, touchingEdgeCount]);

  const onNodeHover = useCallback((node) => {
    hoverRef.current = node?.id ?? null;
    setHoverNode(node ?? null);
  }, []);

  // シングルクリック=詳細表示とつながりの強調。ダブルクリック（同じノードを400ms以内に
  // 再クリック）=そのノード（論文でもConcept/Method/Representationでも）を中心に表示。
  const handleNodeClick = useCallback((node) => {
    const now = Date.now();
    const isDoubleClick = lastClickRef.current.id === node.id && now - lastClickRef.current.time < 400;
    lastClickRef.current = { id: node.id, time: now };
    if (isDoubleClick) {
      onNodeDoubleClick(node.ref);
      return;
    }
    onNodeClick(node.ref);
  }, [onNodeClick, onNodeDoubleClick]);

  const handleLinkClick = useCallback((l) => onEdgeClick(l.relation), [onEdgeClick]);

  return (
    <div ref={wrapRef} className="ego-canvas">
      {overlays}
      <ForceGraph2D
        ref={fgRef}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="#ffffff"
        nodeId="id"
        nodeLabel={() => ''}
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={paintPointerArea}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkLineDash={linkLineDash}
        linkCanvasObjectMode={linkCanvasObjectMode}
        linkCanvasObject={linkCanvasObject}
        onNodeHover={onNodeHover}
        onNodeClick={handleNodeClick}
        onLinkClick={handleLinkClick}
        onBackgroundClick={onBackgroundClick}
        onEngineStop={onEngineStop}
        warmupTicks={30}
        cooldownTime={3000}
        minZoom={0.1}
        maxZoom={16}
      />
      {!data.nodes.length && (
        <div className="map-empty" role="status">
          <strong>表示できるノードがありません</strong>
        </div>
      )}
      {data.truncated > 0 && (
        <div className="overlay-box truncated-note">
          関連が多いため {data.truncated} 件を省略表示中（種別ごとに比例配分）。
        </div>
      )}
      {hoverNode && (
        <div className="map-hover ego-hover">
          <strong>{hoverNode.isCenter ? `${kindLabelOf(hoverNode)}: ${hoverNode.label}` : hoverNode.label}</strong>
          <small>
            {hoverNode.kind === 'paper'
              ? `${CATEGORIES[hoverNode.category] ?? hoverNode.category}${hoverNode.score != null ? ` · score ${hoverNode.score}` : ''}${hoverNode.indirect ? ' · 類似論文の類似論文' : ''}`
              : `${ENTITY_LABELS[hoverNode.kind] ?? hoverNode.kind}${hoverNode.degree != null ? ` · ${hoverNode.degree}件の論文と接続` : ''}`}
          </small>
        </div>
      )}
    </div>
  );
}
