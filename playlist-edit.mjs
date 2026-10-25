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
  desired.forEach((item, position) => {
    const index = item.itemId === null ? -1 : work.findIndex(old => old.itemId === item.itemId);
    if (index === position) return;
    operations.push({ method: index < 0 ? 'POST' : 'PUT', item, position });
    if (index >= 0) work.splice(index, 1);
    work.splice(position, 0, item);
  });
  // ponytail: a small save keeps request time and Google write quota bounded; split larger edits into separate saves.
  if (operations.length > 10) throw new Error('Save at most 10 changes at a time. Make a smaller edit.');
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
