import { normaliseModel, unsupportedEvidence, type EvidenceLevel } from './evidence'
import type { Interval } from './format-interval'
import { mockRecommendations } from './mock-recommendations'
import type { Appliance, Recommendation, SourceDocument } from './model'

// A maintenance task a person on the team has checked against a real manufacturer document.
// `modelScope` is an exact model ("SMS6ZCI49E") or a family prefix ending in "*" ("SMS6*").
export type CatalogEntry = {
  manufacturer: string
  modelScope: string
  sourceType: 'manufacturer_manual' | 'manufacturer_website'
  title: string
  reference: string | null
  sourceLocation: string | null
  taskName: string
  description: string
  interval: Interval
}

const norm = normaliseModel

function matches(entry: CatalogEntry, appliance: Pick<Appliance, 'manufacturer' | 'model'>): 'exact' | 'family' | null {
  if (norm(entry.manufacturer) !== norm(appliance.manufacturer) || !appliance.model) return null
  const model = norm(appliance.model)
  if (entry.modelScope.endsWith('*')) {
    const prefix = norm(entry.modelScope.slice(0, -1))
    return prefix.length > 0 && model.startsWith(prefix) ? 'family' : null
  }
  return norm(entry.modelScope) === model ? 'exact' : null
}

// Proposed recommendations for an appliance: exact-model entries are Manufacturer verified,
// family entries are Similar-model guidance, and with neither Keeply falls back to General
// guidance. Every result passes `unsupportedEvidence`, so nothing is ever over-claimed.
export function proposeRecommendations(
  appliance: Pick<Appliance, 'id' | 'manufacturer' | 'model'>,
  catalog: readonly CatalogEntry[],
): Recommendation[] {
  const exact = catalog.filter((e) => matches(e, appliance) === 'exact')
  const family = catalog.filter((e) => matches(e, appliance) === 'family')
  const [chosen, level]: [CatalogEntry[], EvidenceLevel] = exact.length > 0 ? [exact, 'manufacturer_verified'] : [family, 'similar_model']
  if (chosen.length === 0) return mockRecommendations(appliance)

  return chosen.map((entry, i) => {
    const source: SourceDocument = {
      id: `catalog:${norm(entry.manufacturer)}:${entry.modelScope}:${entry.title}`,
      sourceType: entry.sourceType,
      title: entry.title,
      reference: entry.reference,
      manufacturer: entry.manufacturer,
      modelScope: entry.modelScope,
    }
    const problem = unsupportedEvidence(level, source, appliance.model)
    if (problem) throw new Error(`Catalog entry "${entry.taskName}" is not supported: ${problem}`)
    return {
      id: `${appliance.id}:catalog-${i + 1}`,
      applianceId: appliance.id,
      taskName: entry.taskName,
      description: entry.description,
      recommendedInterval: { ...entry.interval },
      evidenceLevel: level,
      source,
      sourceLocation: entry.sourceLocation,
    }
  })
}
