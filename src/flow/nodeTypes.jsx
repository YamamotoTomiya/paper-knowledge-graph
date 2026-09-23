import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { CATEGORY_TEXT_COLORS, ENTITY_LABELS } from '../data/graph.js';

const dot = (color) => (
  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: color, marginRight: 6 }} />
);

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
  const color = CATEGORY_TEXT_COLORS[data.category] ?? '#0f172a';
  return (
    <BaseNode style={{ border: `2px solid ${color}`, fontWeight: 700, maxWidth: 260 }}>
      <div style={{ color, fontSize: 10, fontWeight: 600, marginBottom: 2 }}>この論文</div>
      <div>{data.label}</div>
      {data.score != null && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>score {data.score}</div>}
    </BaseNode>
  );
}

function PaperNode({ data }) {
  const color = CATEGORY_TEXT_COLORS[data.category] ?? '#0369a1';
  return (
    <BaseNode
      style={{
        border: data.indirect ? `1px dashed ${color}` : `1px solid ${color}`,
        maxWidth: data.indirect ? 180 : 220,
        opacity: data.indirect ? 0.85 : 1,
      }}
      dimmed={data.dimmed}
    >
      {data.indirect && (
        <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>類似論文の類似論文</div>
      )}
      {dot(color)}
      {data.label}
      {data.score != null && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>score {data.score}</div>}
    </BaseNode>
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
