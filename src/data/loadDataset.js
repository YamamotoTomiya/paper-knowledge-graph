export async function loadDataset(baseUrl) {
  const read = async (name) => {
    const response = await fetch(`${baseUrl}data/${name}`);
    if (!response.ok) throw new Error(`データを取得できませんでした (${response.status}: ${name})`);
    return response.json();
  };
  const [papers, graph] = await Promise.all([read('papers.json'), read('graph.json')]);
  if (!papers.dataset_id || papers.dataset_id !== graph.dataset_id) {
    throw new Error('データの更新中です。再読み込みしてください。');
  }
  return [papers, graph];
}
