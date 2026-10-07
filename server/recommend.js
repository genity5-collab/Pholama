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

module.exports = { pickRecommended, releasedKey };
