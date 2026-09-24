// 選択ノード（論文 または Concept/Method/Representation）のエゴネットワークを
// react-force-graph-2d用の{nodes, links}に変換する。中心が論文の場合は、1ホップ
// （類似論文 + Concept/Method/Representation）に加えて、直接の類似論文がさらに持つ
// 類似論文（2ホップ、間接）も少数取り込む。中心1本だけの「星型」だと対象論文にしか
// 繋がりが見えず他の論文同士の繋がりが分からないため（見にくい・他の論文が見えない、
// というフィードバックを踏まえた変更）、間接ノードはその親（直接の隣接論文）に繋げて
// 描画する。中心がConcept/Method/Representationの場合は、それを扱う論文だけを
// 1ホップで表示する（間接展開は論文間の類似度に特有の考え方なので中心が論文の時のみ行う）。
// 実際のレイアウト（座標）は力学シミュレーション（ForceGraph2D内蔵）に任せる。
import { RELATION_TYPE_JA, degreeOf, neighborsOf, nodeInfo, nodeKey, nodeName } from '../data/graph.js';

const GROUP_ORDER = ['SIMILAR_TO', 'DISCUSSES', 'USES_METHOD', 'USES_REPRESENTATION'];
const INDIRECT_PER_PARENT = 5;

// 直接の類似論文それぞれについて、そのさらに類似論文（中心や既存の隣接ノードと重複しないもの）を
// 少数だけ拾う。局所マップ上では「親（直接隣接論文）」に繋げて表示する間接ノードとして返す。
function collectIndirectPapers(centerKey, directPapers, existingKeys, maxIndirect) {
  const indirect = new Map(); // key -> { key, ref, relations:[relation], primaryType, indirect, parentKey }
  for (const parent of directPapers) {
    if (indirect.size >= maxIndirect) break;
    const grandNeighbors = neighborsOf(parent.ref)
      .filter((l) => l.other.kind === 'paper')
      .map((l) => ({ key: nodeKey(l.other), ref: l.other, relation: l.relation }))
      .filter((c) => c.key !== centerKey && !existingKeys.has(c.key) && !indirect.has(c.key))
      .sort((a, b) => (b.relation.score ?? 0) - (a.relation.score ?? 0))
      .slice(0, INDIRECT_PER_PARENT);
    for (const c of grandNeighbors) {
      if (indirect.size >= maxIndirect) break;
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

// centerRef: {kind:'paper', key:url} または {kind:'concept'|'method'|'representation', key:normalized_name}
export function buildEgoGraph(centerRef, { maxNeighbors = 100 } = {}) {
  const center = nodeInfo(centerRef);
  if (!center) return { nodes: [], links: [], truncated: 0 };
  const centerKey = nodeKey(centerRef);
  const isPaperCenter = centerRef.kind === 'paper';

  const rels = neighborsOf(centerRef);
  const neighborMap = new Map();
  for (const l of rels) {
    const k = nodeKey(l.other);
    if (!neighborMap.has(k)) neighborMap.set(k, { key: k, ref: l.other, relations: [] });
    neighborMap.get(k).relations.push(l.relation);
  }
  for (const nb of neighborMap.values()) {
    nb.relations.sort((a, b) => GROUP_ORDER.indexOf(a.type) - GROUP_ORDER.indexOf(b.type));
    nb.primaryType = nb.relations[0].type;
  }

  // 間接展開（2ホップ）は論文間の類似度に特有の考え方なので、中心が論文の時だけ行う。
  // 可視化候補数（maxNeighbors）が増えたらその分間接ノードの上限も緩める。
  let indirectPapers = [];
  if (isPaperCenter) {
    const directPapers = [...neighborMap.values()].filter((nb) => nb.ref.kind === 'paper');
    const maxIndirect = Math.max(15, Math.round(maxNeighbors * 0.3));
    indirectPapers = collectIndirectPapers(centerKey, directPapers, new Set(neighborMap.keys()), maxIndirect);
  }

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

  // 中心は原点に固定する（fx/fy）。力学シミュレーションが原点を中心に周囲へ広がる。
  const centerNode = {
    id: centerKey,
    kind: centerRef.kind,
    isCenter: true,
    label: isPaperCenter ? center.title : center.name,
    score: isPaperCenter ? center.score : null,
    category: isPaperCenter ? center.category : null,
    degree: degreeOf(centerRef),
    ref: centerRef,
    fx: 0,
    fy: 0,
  };

  const nodes = [
    centerNode,
    ...neighbors.map((nb) => {
      const info = nodeInfo(nb.ref);
      return {
        id: nb.key,
        kind: nb.ref.kind,
        isCenter: false,
        label: nodeName(nb.ref),
        score: nb.ref.kind === 'paper' ? info?.score : null,
        category: nb.ref.kind === 'paper' ? info?.category : null,
        degree: degreeOf(nb.ref),
        indirect: !!nb.indirect,
        ref: nb.ref,
      };
    }),
  ];

  // 間接ノードの親は直接隣接論文（visibleKeysに含まれる）、直接ノードの相手は中心。
  // どちらもallVisibleに含まれる関係だけをリンクとして描く。
  const visibleKeys = new Set(neighbors.map((nb) => nb.key));
  const allVisible = new Set([...visibleKeys, centerKey]);
  const links = [];
  for (const nb of neighbors) {
    for (const rel of nb.relations) {
      const sKey = nodeKey(rel.source);
      const tKey = nodeKey(rel.target);
      if (!allVisible.has(sKey) || !allVisible.has(tKey)) continue;
      links.push({
        id: rel.id,
        source: sKey,
        target: tKey,
        type: rel.type,
        typeJa: RELATION_TYPE_JA[rel.type] ?? rel.type,
        scoreVal: rel.score ?? rel.confidence,
        indirect: !!nb.indirect,
        relation: rel,
      });
    }
  }

  return { nodes, links, truncated };
}
