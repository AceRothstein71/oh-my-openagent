import type {
  Extension,
  ExtensionRuntime,
  LoadExtensionsResult,
  ResourceLoader,
} from "@code-yeongyu/senpi"

export type MinimalSenpiResourceLoaderOptions = {
  readonly runtime: ExtensionRuntime
  /** The ONLY extensions a child may load - deliberately empty by default (child suppression). */
  readonly extensions?: readonly Extension[]
}

export function createMinimalSenpiResourceLoader(options: MinimalSenpiResourceLoaderOptions): ResourceLoader {
  const extensionsResult: LoadExtensionsResult = {
    extensions: [...(options.extensions ?? [])],
    errors: [],
    runtime: options.runtime,
  }

  return {
    getExtensions() {
      return extensionsResult
    },
    getSkills() {
      return { skills: [], diagnostics: [] }
    },
    getPrompts() {
      return { prompts: [], diagnostics: [] }
    },
    getThemes() {
      return { themes: [], diagnostics: [] }
    },
    getAgentsFiles() {
      return { agentsFiles: [] }
    },
    getSystemPrompt() {
      return undefined
    },
    getSystemPromptSource() {
      return undefined
    },
    getAppendSystemPrompt() {
      return []
    },
    getAppendSystemPromptSources() {
      return []
    },
    extendResources() {},
    async reload() {},
  }
}
