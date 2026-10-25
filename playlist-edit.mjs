const videoId = /^[A-Za-z0-9_-]{11}$/;
const entryId = /^[\x21-\x7e]{1,256}$/;

export function editable(items) {
  return items.every(item => entryId.test(item.itemId ?? '') && videoId.test(item.id ?? '')) &&
    new Set(items.map(item => item.itemId)).size === items.length;
}
export const snapshot = items => JSON.stringify(items.map(({ itemId, id }) => [itemId, id]));

export function editPlan(original, desired) {
  if (!Array.isArray(desired) || desired.length > 100) throw new Error('Use at most 100 songs.');
  const seen = new Set();
  for (const item of desired) {
    if (!item || typeof item.id !== 'string' || !videoId.test(item.id) || (item.itemId !== null &&
      (!entryId.test(item.itemId ?? '') || seen.has(item.itemId) || !original.some(old => old.itemId === item.itemId && old.id === item.id)))) throw new Error('Invalid playlist entry. Reload the playlist.');
    if (item.itemId !== null) seen.add(item.itemId);
  }
  const work = original.filter(item => seen.has(item.itemId));
  const operations = original.filter(item => !seen.has(item.itemId)).map(item => ({ method: 'DELETE', item }));
  function moves(reverse = false) {
    const current = work.slice(), result = [], positions = [...desired.keys()];
    if (reverse) positions.reverse();
    for (const position of positions) {
      const item = desired[position], index = item.itemId === null ? -1 : current.findIndex(old => old.itemId === item.itemId);
      if (index === position) continue;
      result.push({ method: index < 0 ? 'POST' : 'PUT', item, position });
      if (index >= 0) current.splice(index, 1);
      current.splice(position, 0, item);
    }
    return result;
  }
  const forward = moves(), backward = desired.every(item => item.itemId !== null) ? moves(true) : forward;
  operations.push(...(backward.length < forward.length ? backward : forward));
  return operations;
}

export async function readDraft(req) {
  let body = '';
  const timeout = setTimeout(() => req.destroy(), 5000);
  try {
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 32768) throw new Error('Draft too large.');
    }
    const data = JSON.parse(body);
    if (!data || Object.keys(data).sort().join(',') !== 'id,items,ticket' || typeof data.ticket !== 'string' || data.ticket.length > 100) throw new Error('Invalid draft.');
    return data;
  } finally { clearTimeout(timeout); }
}
