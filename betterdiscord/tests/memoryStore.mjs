// stands in for the IndexedDB per-account store
export function memoryStore(initial = {}) {
    const map = new Map(Object.entries(initial));
    return { map, get: async id => structuredClone(map.get(id)), put: async (id, value) => void map.set(id, structuredClone(value)) };
}
