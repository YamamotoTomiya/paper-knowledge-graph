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

// ホバー中ノードの接続本数がこれ以下の時だけ、そのノードのエッジに種別・スコアのラベルを出す。
// 隣接数の多いノード（中心など）で全ラベルを出すと重なって読めなくなるため。
const HOVER_LABEL_MAX_EDGES = 8;

function GraphView({ centerUrl, setCenterUrl }) {
  const [selection, setSelection] = useState(null);
  const [history, setHistory] = useState([]);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState(null);
  // React Flowが計測したノードの実サイズ。ノード配列は毎回作り直すので、計測結果を自分で
  // 保持して渡さないとReact Flowが「サイズ未確定」を繰り返し検出し、エッジの接続点が
  // 定まらず点滅して見える（JP_Market_Vis App.jsx の GraphView と同じ対策）。
  const [measured, setMeasured] = useState({});
  const onNodesChange = useCallback((changes) => {
    setMeasured((prev) => {
      let next = null;
      for (const c of changes) if (c.type === 'dimensions' && c.dimensions) (next ??= { ...prev })[c.id] = c.dimensions;
      return next ?? prev;
    });
  }, []);

  const { nodes, edges, truncated } = useMemo(() => buildEgoNetwork(centerUrl), [centerUrl]);

  const displayNodes = useMemo(() => {
    const connected = new Set([hoveredNodeId]);
    if (hoveredNodeId) {
      for (const e of edges) {
        if (e.source === hoveredNodeId) connected.add(e.target);
        if (e.target === hoveredNodeId) connected.add(e.source);
      }
    }
    return nodes.map((n) => ({
      ...n,
      measured: measured[n.id],
      data: { ...n.data, dimmed: hoveredNodeId ? !connected.has(n.id) : false },
    }));
  }, [nodes, edges, hoveredNodeId, measured]);

  // ホバー中ノードに繋がるエッジの本数（ラベルを出しても重ならないくらい少ないか判定するため）
  const hoverNodeEdgeCount = useMemo(
    () => (hoveredNodeId ? edges.filter((e) => e.source === hoveredNodeId || e.target === hoveredNodeId).length : 0),
    [edges, hoveredNodeId],
  );

  // 通常時のエッジは無地（矢印・線のみ）。ホバー中のノード/エッジだけ強調し、
  // 繋がりが少ない時だけ種別・スコアのラベルを添える（JP_Market_Vis の displayEdges と同じ方針）。
  const displayEdges = useMemo(() => {
    const labelOk = hoverNodeEdgeCount > 0 && hoverNodeEdgeCount <= HOVER_LABEL_MAX_EDGES;
    return edges.map((e) => {
      const touchesHoverNode = hoveredNodeId && (e.source === hoveredNodeId || e.target === hoveredNodeId);
      const isHoverEdge = e.id === hoveredEdgeId;
      if (!hoveredNodeId && !isHoverEdge) return e;
      const dim = hoveredNodeId && !touchesHoverNode;
      const emphasize = isHoverEdge || touchesHoverNode;
      const withLabel = isHoverEdge || (touchesHoverNode && labelOk);
      const label = withLabel
        ? `${e.data.typeJa}${e.data.scoreVal != null ? ` ${e.data.scoreVal.toFixed(2)}` : ''}`
        : '';
      return {
        ...e,
        label,
        style: {
          ...e.style,
          opacity: dim ? 0.1 : emphasize ? 1 : e.style.opacity,
          strokeWidth: emphasize ? 2.6 : e.style.strokeWidth,
        },
      };
    });
  }, [edges, hoveredNodeId, hoveredEdgeId, hoverNodeEdgeCount]);

  // クリック = 詳細表示（中心ノードも含め、表示中のどの論文/エンティティでも共通）。
  // 中心を切り替える「関係グラフを開く」操作はダブルクリック、または詳細パネルの
  // ボタンから明示的に行う（クリックしただけで中心が変わると誤操作しやすいため）。
  const onNodeClick = useCallback((_, node) => {
    setSelection({ kind: 'node', ref: node.data.ref, info: nodeInfo(node.data.ref) });
  }, []);

  const recenterOn = useCallback((url) => {
    if (url === centerUrl) return;
    setHistory((h) => [...h, centerUrl]);
    setCenterUrl(url);
    setSelection(null);
  }, [centerUrl, setCenterUrl]);

  const onNodeDoubleClick = useCallback((_, node) => {
    const ref = node.data.ref;
    if (ref.kind === 'paper') recenterOn(ref.key);
  }, [recenterOn]);

  const onEdgeClick = useCallback((_, edge) => setSelection({ kind: 'edge', relation: edge.data.relation }), []);
  const onNodeMouseEnter = useCallback((_, node) => setHoveredNodeId(node.id), []);
  const onNodeMouseLeave = useCallback(() => setHoveredNodeId(null), []);
  const onEdgeMouseEnter = useCallback((_, edge) => setHoveredEdgeId(edge.id), []);
  const onEdgeMouseLeave = useCallback(() => setHoveredEdgeId(null), []);

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
        <div className="overlay-box graph-caption">
          点線=類似論文のさらに類似論文（間接）。クリックで詳細、ダブルクリックでその論文を中心に表示します。
        </div>
        <BackBar history={history} onBack={onBack} />
        {truncated > 0 && (
          <div className="overlay-box truncated-note">
            関連が多いため {truncated} 件を省略表示中（種別ごとに比例配分）。
          </div>
        )}
        <ReactFlow
          key={centerUrl}
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeClick={onEdgeClick}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
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
      <DetailPanel selection={selection} centerUrl={centerUrl} onClose={() => setSelection(null)} onCenterPaper={recenterOn} />
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
