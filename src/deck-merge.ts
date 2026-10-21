// fork: three-way merge of two edits of the same deck, for several editors on one deck file.
//
// merge(base, theirs, mine): `base` is the version both edits started from. Whatever only one
// side changed is kept. Objects merge key by key, and lists of objects with an `id` (slides,
// elements, animations) merge item by item, so two people can work on different slides, or on
// different elements of one slide, at the same time. Only when both changed the same value
// differently does `mine` win; that path is reported in `conflicts`.

type Json = any

export interface MergeResult<T> { value: T; conflicts: string[] }

const isObj = (x: Json) => x !== null && typeof x === 'object' && !Array.isArray(x)

export function same(a: Json, b: Json): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]))
  const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined)
  return ka.length === kb.length && ka.every(k => same(a[k], b[k]))
}

const idList = (x: Json) => Array.isArray(x) && x.every(i => isObj(i) && typeof i.id === 'string') &&
  new Set(x.map((i: Json) => i.id)).size === x.length

function value(b: Json, t: Json, m: Json, path: string, conflicts: string[]): Json {
  if (same(m, b)) return t
  if (same(t, b) || same(t, m)) return m
  if (isObj(b) && isObj(t) && isObj(m)) {
    const out: Json = {}
    for (const k of new Set([...Object.keys(b), ...Object.keys(t), ...Object.keys(m)])) {
      const v = value(b[k], t[k], m[k], `${path}/${k}`, conflicts)
      if (v !== undefined) out[k] = v
    }
    return out
  }
  if (idList(b) && idList(t) && idList(m)) return list(b, t, m, path, conflicts)
  conflicts.push(path)
  return m
}

function list(b: Json[], t: Json[], m: Json[], path: string, conflicts: string[]): Json[] {
  const map = (x: Json[]) => new Map<string, Json>(x.map(i => [i.id, i]))
  const B = map(b), T = map(t), M = map(m)
  const kept = new Map<string, Json>()
  for (const id of new Set([...T.keys(), ...M.keys()])) {
    const v = value(B.get(id), T.get(id), M.get(id), `${path}/${id}`, conflicts)
    if (v !== undefined) kept.set(id, v)
  }
  // order: whoever reordered the items they share with base; theirs if neither or both did
  const reordered = (x: Json[]) => {
    const common = x.map(i => i.id).filter(id => B.has(id))
    return !same(common, b.map(i => i.id).filter(id => common.includes(id)))
  }
  const [primary, secondary] = reordered(m) && !reordered(t) ? [m, t] : [t, m]
  const order = primary.map(i => i.id).filter(id => kept.has(id))
  const inSecondary = new Set(secondary.map(i => i.id))
  secondary.forEach((item, i) => {
    if (order.includes(item.id) || !kept.has(item.id)) return
    let at = 0                                   // after its nearest predecessor that is placed
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(secondary[j].id)
      if (k >= 0) { at = k + 1; break }
    }
    // ...and after what only the other side added there, so both additions keep their order
    while (at < order.length && !B.has(order[at]) && !inSecondary.has(order[at])) at++
    order.splice(at, 0, item.id)
  })
  return order.map(id => kept.get(id))
}

export function merge<T>(base: T, theirs: T, mine: T): MergeResult<T> {
  const conflicts: string[] = []
  return { value: value(base, theirs, mine, '', conflicts), conflicts }
}
