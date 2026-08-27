function normalizeModelName(name: string): string {
	return name
		.toLowerCase()
		.replace(/claude-(opus|sonnet|haiku)-(\d+)[.-](\d+)/g, "claude-$1-$2.$3")
		.replace(/kimi-k2[.-](\d+)/g, "kimi-k2.$1")
		.replace(/\b(glm|gpt)-(\d+)[.-](\d+)/g, "$1-$2.$3")
}

function canonicalModelIDs(provider: string | undefined, modelID: string): readonly string[] {
	if (provider !== "vercel") return [modelID]
	const separator = modelID.indexOf("/")
	return separator === -1 ? [modelID] : [modelID, modelID.slice(separator + 1)]
}

export function fuzzyMatchModel(
	target: string,
	available: Set<string>,
	providers?: string[],
): string | null {
	if (available.size === 0) {
		return null
	}

	const targetNormalized = normalizeModelName(target)

	let candidates = Array.from(available)
	if (providers && providers.length > 0) {
		const providerSet = new Set(providers)
		candidates = candidates.filter((model) => {
			const [provider] = model.split("/")
			return providerSet.has(provider)
		})
	}

	if (candidates.length === 0) {
		return null
	}

	const matches = candidates.filter((model) =>
		normalizeModelName(model).includes(targetNormalized),
	)

	if (matches.length === 0) {
		return null
	}

	const exactMatch = matches.find((model) => normalizeModelName(model) === targetNormalized)
	if (exactMatch) {
		return exactMatch
	}

	const exactModelIdMatches = matches.filter((model) => {
		const modelId = model.split("/").slice(1).join("/")
		return normalizeModelName(modelId) === targetNormalized
	})
	if (exactModelIdMatches.length > 0) {
		return exactModelIdMatches.reduce((shortest, current) =>
			current.length < shortest.length ? current : shortest,
		)
	}

	return matches.reduce((shortest, current) =>
		current.length < shortest.length ? current : shortest,
	)
}

export function isModelAvailable(
	targetModel: string,
	availableModels: Set<string>,
): boolean {
	return fuzzyMatchModel(targetModel, availableModels) !== null
}

/**
 * Exact model-ID match across providers: no substring tolerance, unlike
 * {@link fuzzyMatchModel}. A variant sibling (`minimax-m2.7-highspeed` for
 * target `minimax-m2.7`) never matches (#7325). Shortest full id wins.
 */
export function findModelIdAcrossProviders(
	targetModelID: string,
	available: ReadonlySet<string>,
	excludeProviders?: ReadonlySet<string>,
): string | null {
	if (available.size === 0) {
		return null
	}

	const targetNormalized = normalizeModelName(targetModelID)
	if (!targetNormalized) {
		return null
	}

	const matches = Array.from(available).filter((model) => {
		const separator = model.indexOf("/")
		const provider = separator === -1 ? undefined : model.slice(0, separator)
		if (excludeProviders?.has(provider ?? "")) {
			return false
		}
		const modelID = separator === -1 ? model : model.slice(separator + 1)
		return canonicalModelIDs(provider, modelID)
			.some((candidate) => normalizeModelName(candidate) === targetNormalized)
	})

	if (matches.length === 0) {
		return null
	}

	return matches.reduce((shortest, current) =>
		current.length < shortest.length ? current : shortest,
	)
}
