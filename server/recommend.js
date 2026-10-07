// Which model to recommend for a computer. Pure (no files, no process) so it is tested on its own.
// The RECOMMENDED model is the best one that can run tools and still fits this PC WITH ROOM TO SPARE.
// Small PCs get the smallest tool model (nothing bigger fits comfortably). Bigger PCs get a newer and stronger one, instead of
// everyone being told to use the same 2024 3B model. Computed from the catalog, never hard-coded, so it stays right when models are added.
const releasedKey = m => String(m.released || '0000-00');
function pickRecommended(list, budget) {
  const ok = list.filter(m => m.toolTier === 'good' && budget >= m.minRamGB);   // never recommend a model that cannot really run tools
  if (!ok.length) return null;
  // comfortable = the file plus about 2 GB for chat memory, the browser and the system. Keep the model under half of the memory budget.
  const comfy = ok.filter(m => m.sizeGB <= budget * 0.5 && m.sizeGB + 2 <= budget);
  if (!comfy.length) return ok.slice().sort((a, b) => a.bytes - b.bytes)[0].id;   // tight PC: the smallest that works
  // among the comfortable ones: newest generation first, then the bigger (stronger) one
  comfy.sort((a, b) => releasedKey(b).localeCompare(releasedKey(a)) || b.bytes - a.bytes);
  return comfy[0].id;
}

// The "smart tool models" list: every model rated good at calling tools whose file is at most maxGB (default 4 GB), newest generation first.
// Only models the catalog already rates 'good' are ever listed, so the list can never promise tool use a model does not have.
// ram is the PC's memory budget (optional): when given, each row says whether it fits comfortably.
function smartToolModels(list, maxGB = 4, ram = 0) {
  const ok = (Array.isArray(list) ? list : []).filter(m => m && m.toolTier === 'good' && m.sizeGB > 0 && m.sizeGB <= maxGB);
  ok.sort((a, b) => releasedKey(b).localeCompare(releasedKey(a)) || b.bytes - a.bytes);
  return ok.map(m => ({ id: m.id, name: m.name, sizeGB: m.sizeGB, minRamGB: m.minRamGB, params: m.params, released: m.released || '', fits: !ram ? null : ram >= m.minRamGB, comfy: !ram ? null : (m.sizeGB <= ram * 0.5 && m.sizeGB + 2 <= ram) }));
}
module.exports = { pickRecommended, releasedKey, smartToolModels };
