// 選択論文のエゴネットワーク（1ホップ: 類似論文 + Concept/Method/Representation）を
// React Flow の nodes/edges に変換する。種別ごとにセクターへ分け、リング状に配置する
// （JP_Market_Vis の src/flow/egoNetwork.js のセクター配置を簡略化したもの）。
import { RELATION_TYPE_JA, degreeOf, neighborsOf, nodeInfo, nodeKey, nodeName } from '../data/graph.js';

const GROUP_ORDER = ['SIMILAR_TO', 'DISCUSSES', 'USES_METHOD', 'USES_REPRESENTATION'];
const GROUP_COLOR = {
  SIMILAR_TO: '#0369a1',
  DISCUSSES: '#166534',
  USES_METHOD: '#9a3412',
  USES_REPRESENTATION: '#6d28d9',
};

const BASE_RADIUS = 260;
const RING_GAP = 150;
const NODE_ARC = 130;
const SECTOR_GAP = 0.14;

function layoutSector(members, angleStart, span, positions) {
  let placed = 0;
  let ring = 0;
  while (placed < members.length) {
    const radius = BASE_RADIUS + ring * RING_GAP;
    const arc = span * radius;
    const capacity = Math.max(1, Math.floor(arc / NODE_ARC));
    const countThisRing = Math.min(capacity, members.length - placed);
    for (let j = 0; j < countThisRing; j += 1) {
      const frac = countThisRing === 1 ? 0.5 : j / (countThisRing - 1);
      const a = angleStart + span * (0.08 + 0.84 * frac);
      positions.set(members[placed + j].key, { x: Math.cos(a) * radius, y: Math.sin(a) * radius });
    }
    placed += countThisRing;
    ring += 1;
  }
}

export function buildEgoNetwork(paperUrl, { maxNeighbors = 60 } = {}) {
  const centerRef = { kind: 'paper', key: paperUrl };
  const center = nodeInfo(centerRef);
  if (!center) return { nodes: [], edges: [], truncated: 0 };

  let links = neighborsOf(centerRef);

  const neighborMap = new Map();
  for (const l of links) {
    const k = nodeKey(l.other);
    if (!neighborMap.has(k)) neighborMap.set(k, { key: k, ref: l.other, relations: [] });
    neighborMap.get(k).relations.push(l.relation);
  }
  for (const nb of neighborMap.values()) {
    nb.relations.sort((a, b) => GROUP_ORDER.indexOf(a.type) - GROUP_ORDER.indexOf(b.type));
    nb.primaryType = nb.relations[0].type;
  }

  let neighbors = [...neighborMap.values()];
  const totalNeighbors = neighbors.length;
  neighbors.sort((a, b) => {
    const ta = GROUP_ORDER.indexOf(a.primaryType);
    const tb = GROUP_ORDER.indexOf(b.primaryType);
    if (ta !== tb) return ta - tb;
    const scoreA = a.relations[0].score ?? a.relations[0].confidence ?? 0;
    const scoreB = b.relations[0].score ?? b.relations[0].confidence ?? 0;
    return scoreB - scoreA;
  });
  let truncated = 0;
  if (neighbors.length > maxNeighbors) {
    const byType = new Map();
    for (const nb of neighbors) {
      if (!byType.has(nb.primaryType)) byType.set(nb.primaryType, []);
      byType.get(nb.primaryType).push(nb);
    }
    const kept = [];
    for (const [, list] of byType) {
      const quota = Math.max(1, Math.round((list.length / totalNeighbors) * maxNeighbors));
      kept.push(...list.slice(0, quota));
    }
    truncated = neighbors.length - kept.length;
    neighbors = kept;
  }

  const groups = [];
  for (const type of GROUP_ORDER) {
    const members = neighbors.filter((nb) => nb.primaryType === type);
    if (members.length) groups.push({ type, members });
  }

  const n = neighbors.length || 1;
  const positions = new Map();
  const usable = 2 * Math.PI - SECTOR_GAP * groups.length;
  let angle = -Math.PI / 2;
  for (const g of groups) {
    const span = Math.max(0.2, usable * (g.members.length / n));
    layoutSector(g.members, angle, span, positions);
    angle += span + SECTOR_GAP;
  }

  const nodes = [
    {
      id: nodeKey(centerRef),
      type: 'center',
      position: { x: 0, y: 0 },
      data: { label: center.title, score: center.score, category: center.category, ref: centerRef },
    },
    ...neighbors.map((nb) => {
      const info = nodeInfo(nb.ref);
      return {
        id: nb.key,
        type: nb.ref.kind === 'paper' ? 'paper' : 'entity',
        position: positions.get(nb.key) ?? { x: 0, y: 0 },
        data: {
          label: nodeName(nb.ref),
          kind: nb.ref.kind,
          score: nb.ref.kind === 'paper' ? info?.score : null,
          category: nb.ref.kind === 'paper' ? info?.category : null,
          degree: degreeOf(nb.ref),
          ref: nb.ref,
        },
      };
    }),
  ];

  const visibleKeys = new Set(neighbors.map((nb) => nb.key));
  const centerKey = nodeKey(centerRef);
  const edges = [];
  for (const nb of neighbors) {
    for (const rel of nb.relations) {
      const color = GROUP_COLOR[rel.type] ?? '#64748b';
      const sKey = nodeKey(rel.source);
      const tKey = nodeKey(rel.target);
      if (!visibleKeys.has(sKey === centerKey ? tKey : sKey)) continue;
      const scoreVal = rel.score ?? rel.confidence;
      edges.push({
        id: rel.id,
        source: sKey,
        target: tKey,
        type: 'default',
        label: scoreVal != null ? scoreVal.toFixed(2) : '',
        labelStyle: { fill: '#0f172a', fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
        labelBgPadding: [3, 2],
        labelBgBorderRadius: 3,
        style: { stroke: color, strokeWidth: 1.5, opacity: 0.85 },
        data: { relation: rel, typeJa: RELATION_TYPE_JA[rel.type] ?? rel.type },
      });
    }
  }

  return { nodes, edges, truncated };
}
