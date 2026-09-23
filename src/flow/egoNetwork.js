// 選択論文のエゴネットワークをReact Flowのnodes/edgesに変換する。
// 1ホップ（類似論文 + Concept/Method/Representation）に加えて、直接の類似論文がさらに
// 持つ類似論文（2ホップ、間接）も少数だけ取り込む。中心1本だけの「星型」だと対象論文にしか
// 繋がりが見えず他の論文同士の繋がりが分からないため（見にくい・他の論文が見えない、という
// フィードバックを踏まえた変更）、間接ノードはその親（直接の隣接論文）に繋げて描画する。
// 種別ごとにセクターへ分け、リング状に配置する
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
const INDIRECT_PER_PARENT = 3;
const MAX_INDIRECT = 15;

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

// 直接の類似論文それぞれについて、そのさらに類似論文（中心や既存の隣接ノードと重複しないもの）を
// 少数だけ拾う。関係グラフ上では「親（直接隣接論文）」に繋げて表示する間接ノードとして返す。
function collectIndirectPapers(centerKey, directPapers, existingKeys) {
  const indirect = new Map(); // key -> { key, ref, relations:[relation], primaryType, indirect, parentKey }
  for (const parent of directPapers) {
    if (indirect.size >= MAX_INDIRECT) break;
    const grandNeighbors = neighborsOf(parent.ref)
      .filter((l) => l.other.kind === 'paper')
      .map((l) => ({ key: nodeKey(l.other), ref: l.other, relation: l.relation }))
      .filter((c) => c.key !== centerKey && !existingKeys.has(c.key) && !indirect.has(c.key))
      .sort((a, b) => (b.relation.score ?? 0) - (a.relation.score ?? 0))
      .slice(0, INDIRECT_PER_PARENT);
    for (const c of grandNeighbors) {
      if (indirect.size >= MAX_INDIRECT) break;
      indirect.set(c.key, {
        key: c.key,
        ref: c.ref,
        relations: [c.relation],
        primaryType: 'SIMILAR_TO',
        indirect: true,
        parentKey: parent.key,
      });
    }
  }
  return [...indirect.values()];
}

export function buildEgoNetwork(paperUrl, { maxNeighbors = 70 } = {}) {
  const centerRef = { kind: 'paper', key: paperUrl };
  const center = nodeInfo(centerRef);
  if (!center) return { nodes: [], edges: [], truncated: 0 };
  const centerKey = nodeKey(centerRef);

  const links = neighborsOf(centerRef);
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

  const directPapers = [...neighborMap.values()].filter((nb) => nb.ref.kind === 'paper');
  const indirectPapers = collectIndirectPapers(centerKey, directPapers, new Set(neighborMap.keys()));

  let neighbors = [...neighborMap.values(), ...indirectPapers];
  const totalNeighbors = neighbors.length;
  neighbors.sort((a, b) => {
    const ta = GROUP_ORDER.indexOf(a.primaryType);
    const tb = GROUP_ORDER.indexOf(b.primaryType);
    if (ta !== tb) return ta - tb;
    if (!!a.indirect !== !!b.indirect) return a.indirect ? 1 : -1; // 直接隣接を間接より優先して残す
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
      id: centerKey,
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
          indirect: !!nb.indirect,
          ref: nb.ref,
        },
      };
    }),
  ];

  // 間接ノードの親は直接隣接論文（visibleKeysに含まれる）、直接ノードの相手は中心。
  // どちらもallVisibleに含まれる関係だけをエッジとして描く。
  const visibleKeys = new Set(neighbors.map((nb) => nb.key));
  const allVisible = new Set([...visibleKeys, centerKey]);
  const edges = [];
  for (const nb of neighbors) {
    for (const rel of nb.relations) {
      const sKey = nodeKey(rel.source);
      const tKey = nodeKey(rel.target);
      if (!allVisible.has(sKey) || !allVisible.has(tKey)) continue;
      const color = GROUP_COLOR[rel.type] ?? '#64748b';
      const scoreVal = rel.score ?? rel.confidence;
      edges.push({
        id: rel.id,
        source: sKey,
        target: tKey,
        type: 'default',
        // ラベル（種別・スコア）は常時表示せず、ホバー時だけ付与する（App.jsx側で制御）。
        // 常時表示すると隣接数の多い論文で線とラベルが重なり合って読めなくなるため。
        label: '',
        labelStyle: { fill: '#0f172a', fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
        labelBgPadding: [3, 2],
        labelBgBorderRadius: 3,
        style: {
          stroke: color,
          strokeWidth: nb.indirect ? 1 : 1.5,
          opacity: nb.indirect ? 0.45 : 0.85,
          strokeDasharray: nb.indirect ? '4 3' : undefined,
        },
        data: { relation: rel, typeJa: RELATION_TYPE_JA[rel.type] ?? rel.type, scoreVal, indirect: !!nb.indirect },
      });
    }
  }

  return { nodes, edges, truncated };
}
