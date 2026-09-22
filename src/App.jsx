import React, { useCallback, useMemo, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { CATEGORY_TEXT_COLORS, PAPER_ENTRIES, STATS, nodeInfo } from './data/graph.js';
import { buildEgoNetwork } from './flow/egoNetwork.js';
import { nodeTypes } from './flow/nodeTypes.jsx';
import SearchSidebar from './components/SearchSidebar.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import PaperTable from './components/PaperTable.jsx';
import StatsView from './components/StatsView.jsx';
import GlobalMap from './components/GlobalMap.jsx';

const DEFAULT_URL = [...PAPER_ENTRIES].sort((a, b) => b.score - a.score)[0]?.url ?? null;

function Header({ view, setView }) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">◉</span>
        <div>
          <span className="brand-kicker">PAPER KNOWLEDGE GRAPH</span>
          <h1>論文ナレッジグラフ</h1>
        </div>
      </div>
      <nav aria-label="表示切り替え" className="view-tabs">
        {Object.entries({ map: '全体マップ', graph: '関係グラフ', table: '論文一覧', stats: '統計' }).map(([key, label]) => (
          <button
            key={key}
            aria-current={view === key ? 'page' : undefined}
            className={view === key ? 'active' : ''}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
}

function BackBar({ history, onBack }) {
  if (history.length === 0) return null;
  const prevInfo = nodeInfo({ kind: 'paper', key: history[history.length - 1] });
  return (
    <div className="overlay-box back-bar">
      <button className="btn" onClick={onBack}>← {prevInfo?.title ?? '戻る'}</button>
    </div>
  );
}

function GraphView({ centerUrl, setCenterUrl }) {
  const [selection, setSelection] = useState(null);
  const [history, setHistory] = useState([]);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);

  const { nodes, edges, truncated } = useMemo(() => buildEgoNetwork(centerUrl), [centerUrl]);

  const displayNodes = useMemo(() => {
    const connected = new Set([hoveredNodeId]);
    if (hoveredNodeId) {
      for (const e of edges) {
        if (e.source === hoveredNodeId) connected.add(e.target);
        if (e.target === hoveredNodeId) connected.add(e.source);
      }
    }
    return nodes.map((n) => ({ ...n, data: { ...n.data, dimmed: hoveredNodeId ? !connected.has(n.id) : false } }));
  }, [nodes, edges, hoveredNodeId]);

  const onNodeClick = useCallback((_, node) => {
    const ref = node.data.ref;
    if (ref.kind === 'paper' && ref.key !== centerUrl) {
      setHistory((h) => [...h, centerUrl]);
      setCenterUrl(ref.key);
      setSelection(null);
      return;
    }
    setSelection({ kind: 'node', ref, info: nodeInfo(ref) });
  }, [centerUrl, setCenterUrl]);

  const onEdgeClick = useCallback((_, edge) => setSelection({ kind: 'edge', relation: edge.data.relation }), []);
  const onNodeMouseEnter = useCallback((_, node) => setHoveredNodeId(node.id), []);
  const onNodeMouseLeave = useCallback(() => setHoveredNodeId(null), []);

  const onBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setCenterUrl(prev);
      setSelection(null);
      return h.slice(0, -1);
    });
  }, [setCenterUrl]);

  const handleSidebarSelect = useCallback((url) => {
    if (url !== centerUrl) {
      setHistory([]);
      setCenterUrl(url);
      setSelection(null);
    }
  }, [centerUrl, setCenterUrl]);

  if (!centerUrl) return <p className="detail-empty">論文がありません。</p>;

  return (
    <div className="graph-view">
      <SearchSidebar selectedUrl={centerUrl} onSelect={handleSidebarSelect} />
      <div className="ego-canvas">
        <BackBar history={history} onBack={onBack} />
        {truncated > 0 && (
          <div className="overlay-box truncated-note">
            関連が多いため {truncated} 件を省略表示中（種別ごとに比例配分）。
          </div>
        )}
        <ReactFlow
          key={centerUrl}
          nodes={displayNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#cbd5e1" gap={24} />
          <Controls />
          <MiniMap
            style={{ background: '#f8fafc' }}
            nodeColor={(n) => (n.type === 'center' ? '#0369a1' : n.type === 'paper' ? CATEGORY_TEXT_COLORS[n.data.category] ?? '#94a3b8' : '#cbd5e1')}
            maskColor="rgba(248, 250, 252, 0.7)"
          />
        </ReactFlow>
      </div>
      <DetailPanel selection={selection} onClose={() => setSelection(null)} />
    </div>
  );
}

function ViewPane({ active, children }) {
  return (
    <div className={`view-pane${active ? '' : ' view-pane-hidden'}`} aria-hidden={!active} inert={active ? undefined : ''}>
      {children}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('map');
  const [centerUrl, setCenterUrl] = useState(DEFAULT_URL);
  const [visited, setVisited] = useState(() => new Set(['map']));

  const showView = useCallback((key) => {
    setVisited((prev) => (prev.has(key) ? prev : new Set([...prev, key])));
    setView(key);
  }, []);

  const openGraph = useCallback((url) => {
    setCenterUrl(url);
    showView('graph');
  }, [showView]);

  return (
    <div className="app-shell">
      <Header view={view} setView={showView} />
      <ViewPane active={view === 'map'}>
        <GlobalMap onOpenPaper={openGraph} />
      </ViewPane>
      {visited.has('graph') && (
        <ViewPane active={view === 'graph'}><GraphView centerUrl={centerUrl} setCenterUrl={setCenterUrl} /></ViewPane>
      )}
      {visited.has('table') && (
        <ViewPane active={view === 'table'}><PaperTable onOpenGraph={openGraph} /></ViewPane>
      )}
      {visited.has('stats') && (
        <ViewPane active={view === 'stats'}><StatsView /></ViewPane>
      )}
      <footer className="app-footer">
        <span>収録 {STATS.papers.toLocaleString()}論文 · {STATS.relations.toLocaleString()}関係 · {STATS.topics.toLocaleString()}トピック</span>
        <span>paper-bot が日次収集・評価した論文を自動でグラフ化。AI要約・スコアはLLMによる自動評価です。</span>
      </footer>
    </div>
  );
}
