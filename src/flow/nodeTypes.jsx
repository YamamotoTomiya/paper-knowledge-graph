import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { CATEGORY_TEXT_COLORS, ENTITY_LABELS } from '../data/graph.js';

function BaseNode({ children, style, dimmed }) {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        background: '#fff',
        boxShadow: '0 1px 2px rgba(15,23,42,.12)',
        fontSize: 12,
        maxWidth: 220,
        opacity: dimmed ? 0.25 : 1,
        transition: 'opacity 120ms',
        ...style,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      {children}
    </div>
  );
}

function CenterNode({ data }) {
  const isPaper = data.kind === 'paper';
  const color = isPaper ? (CATEGORY_TEXT_COLORS[data.category] ?? '#0f172a') : '#0f172a';
  const kindLabel = isPaper ? 'この論文' : `この${ENTITY_LABELS[data.kind] ?? data.kind}`;
  return (
    <BaseNode style={{ border: `2px solid ${color}`, fontWeight: 700, maxWidth: 260 }}>
      <div style={{ color, fontSize: 10, fontWeight: 600, marginBottom: 2 }}>{kindLabel}</div>
      <div>{data.label}</div>
      {data.score != null && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>score {data.score}</div>}
    </BaseNode>
  );
}

// 全体マップの論文ノードと同じ「円だけ」の見た目にする（カード表示だとタイトルが密集して
// 読みにくいため）。タイトルはホバー時にだけ吹き出しで表示する。
function PaperNode({ data }) {
  const color = CATEGORY_TEXT_COLORS[data.category] ?? '#0369a1';
  const size = data.indirect ? 9 : 15;
  return (
    <div className="paper-dot-wrap" style={{ opacity: data.dimmed ? 0.15 : 1 }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div
        className="paper-dot"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: data.indirect ? 'transparent' : '#fff',
          border: `${data.indirect ? 1 : 2}px ${data.indirect ? 'dashed' : 'solid'} ${color}`,
        }}
      />
      <div className="paper-dot-label">
        {data.indirect && <div className="paper-dot-label-tag">類似論文の類似論文</div>}
        {data.label}
        {data.score != null && <span className="paper-dot-label-score"> score {data.score}</span>}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

function EntityNode({ data }) {
  return (
    <BaseNode style={{ border: '1px dashed #94a3b8', background: '#f8fafc' }} dimmed={data.dimmed}>
      <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase' }}>{ENTITY_LABELS[data.kind] ?? data.kind}</div>
      {data.label}
    </BaseNode>
  );
}

export const nodeTypes = { center: CenterNode, paper: PaperNode, entity: EntityNode };
