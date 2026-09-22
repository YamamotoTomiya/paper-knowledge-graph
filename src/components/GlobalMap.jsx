import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { CATEGORY_TEXT_COLORS, CATEGORY_TOPIC_GRAPH, CATEGORIES } from '../data/graph.js';

const nodeRadius = (size) => Math.max(4, Math.min(46, Math.sqrt(size) * 2.6));
const linkColor = (link) => `${CATEGORY_TEXT_COLORS[link.source.key ?? link.source] ?? '#94a3b8'}33`;

// react-force-graph-2d には円の重なりを避けるcollision forceが標準で無いため、簡易な
// ペアワイズ反発（O(n^2)だが対象は数十ノードなので問題ない）を自前で追加する。
function makeCollideForce(nodes, padding = 10) {
  return (alpha) => {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      const ra = nodeRadius(a.size);
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        const rb = nodeRadius(b.size);
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        // カテゴリ同士は円が大きく密集しやすいので、余白を大きめに取って重なりを防ぐ
        const bothCategories = a.kind === 'category' && b.kind === 'category';
        const minDist = ra + rb + (bothCategories ? padding * 9 : padding);
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        if (dist < minDist) {
          const strength = ((minDist - dist) / dist) * alpha * 0.6;
          const ox = dx * strength;
          const oy = dy * strength;
          a.vx = (a.vx ?? 0) - ox;
          a.vy = (a.vy ?? 0) - oy;
          b.vx = (b.vx ?? 0) + ox;
          b.vy = (b.vy ?? 0) + oy;
        }
      }
    }
  };
}

// カテゴリ→トピックの集計マップ。円の大きさ=論文数、色=カテゴリ。
// クリックでそのカテゴリ/トピックの論文一覧（Table view）へ。
export default function GlobalMap({ onSelectTopic, onSelectCategory }) {
  const fgRef = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoverNode, setHoverNode] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    const resize = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => ({
    nodes: CATEGORY_TOPIC_GRAPH.nodes.map((n) => ({ ...n })),
    links: CATEGORY_TOPIC_GRAPH.links.map((l) => ({ ...l })),
  }), []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength((n) => (n.kind === 'category' ? -900 : -200));
    // トピックは複数カテゴリにまたがることがあり、その共有リンクがカテゴリ同士を中央へ
    // 引き寄せてしまう。リンクの力を弱めて反発（charge/collide）を優先させる。
    fg.d3Force('link')?.distance(90).strength(0.15);
    fg.d3Force('collide', makeCollideForce(data.nodes));
  }, [data]);

  const onEngineStop = useCallback(() => {
    fgRef.current?.zoomToFit(400, 40);
  }, []);

  const drawNode = useCallback((node, ctx, scale) => {
    const isCategory = node.kind === 'category';
    const color = CATEGORY_TEXT_COLORS[isCategory ? node.key : node.dominantCategory] ?? '#94a3b8';
    const r = nodeRadius(node.size) * (node === hoverNode ? 1.15 : 1);
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isCategory ? color : '#ffffff';
    ctx.fill();
    ctx.lineWidth = isCategory ? 0 : 2;
    ctx.strokeStyle = color;
    if (!isCategory) ctx.stroke();

    if (r * scale > 14 || node === hoverNode) {
      const fontSize = Math.max(9, Math.min(13, r * 0.4)) / scale;
      ctx.font = `${isCategory ? 700 : 500} ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isCategory ? '#ffffff' : '#0f172a';
      const label = isCategory ? node.name : node.name.slice(0, 22);
      ctx.fillText(label, node.x, node.y);
    }
  }, [hoverNode]);

  const paintPointerArea = useCallback((node, color, ctx) => {
    const r = nodeRadius(node.size) * (node === hoverNode ? 1.15 : 1);
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, [hoverNode]);

  const onNodeClick = useCallback((node) => {
    if (node.kind === 'topic') onSelectTopic(node.key);
    else onSelectCategory(node.key);
  }, [onSelectTopic, onSelectCategory]);

  return (
    <div className="map-view">
      <aside className="map-sidebar" aria-label="全体マップの説明">
        <h2>論文のつながりを俯瞰する</h2>
        <p>カテゴリ（大きい円）とトピック（小さい円、自動クラスタリング）の関係を一望できます。円の大きさは論文数。クリックすると論文一覧に絞り込まれます。</p>
        <div className="map-totals" aria-live="polite">
          <div><strong>{data.nodes.filter((n) => n.kind === 'category').length}</strong><span>カテゴリ</span></div>
          <div><strong>{data.nodes.filter((n) => n.kind === 'topic').length}</strong><span>トピック</span></div>
        </div>
        <section className="control-section">
          <h3>カテゴリ</h3>
          <div className="legend">
            {Object.entries(CATEGORIES).map(([key, label]) => (
              <span key={key}><i style={{ borderColor: CATEGORY_TEXT_COLORS[key] }} />{label}</span>
            ))}
          </div>
        </section>
      </aside>
      <div ref={wrapRef} className="map-canvas">
        <ForceGraph2D
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor="#ffffff"
          nodeId="id"
          nodeLabel={(n) => `${n.name} · ${n.size.toLocaleString()}件`}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintPointerArea}
          linkColor={linkColor}
          linkWidth={(l) => Math.max(0.5, Math.log2(l.count + 1))}
          onNodeHover={setHoverNode}
          onNodeClick={onNodeClick}
          onEngineStop={onEngineStop}
          warmupTicks={80}
          cooldownTime={5000}
          minZoom={0.2}
          maxZoom={8}
        />
        {hoverNode && (
          <div className="map-hover">
            <strong>{hoverNode.name}</strong>
            <small>{hoverNode.size.toLocaleString()} 件の論文</small>
          </div>
        )}
      </div>
    </div>
  );
}
