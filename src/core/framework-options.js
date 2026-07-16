import { AxError } from "./errors.js";

export const AXF_OPTION_PREFIX = "axf-";

export const AXF_RUN_OPTIONS = Object.freeze({
  json: "axf-json",
  anyLifecycle: "axf-any-lifecycle",
});

export const AXF_ROOT_OPTIONS = Object.freeze([
  {
    field: "workspace",
    legacy: "workspace",
    namespaced: "axf-workspace",
  },
  {
    field: "registryWorkspace",
    legacy: "registry-workspace",
    namespaced: "axf-registry-workspace",
  },
  {
    field: "executionWorkspace",
    legacy: "execution-workspace",
    namespaced: "axf-execution-workspace",
  },
  {
    field: "projectRoot",
    legacy: "project-root",
    namespaced: "axf-project-root",
  },
  {
    field: "executionRoot",
    legacy: "execution-root",
    namespaced: "axf-execution-root",
  },
]);

export const LEGACY_RUN_OPTIONS = Object.freeze({
  json: "json",
  anyLifecycle: "any-lifecycle",
  allowDraft: "allow-draft",
});

// These names were previously rejected for every imported family command,
// even though they are only AXF-owned on other subcommands. Scout uses this
// list solely to detect old standalone workarounds during migration.
export const LEGACY_FAMILY_RESERVED_ARG_NAMES = new Set([
  "json",
  "workspace",
  "any-lifecycle",
  "allow-draft",
  "include-drafts",
  "all",
  "compact",
  "search",
  "side-effects",
  "limit",
  "intent",
]);

export function isFrameworkReservedArgName(name) {
  return typeof name === "string" && name.startsWith(AXF_OPTION_PREFIX);
}

export function capabilityDeclaresArgument(capability, name) {
  return Object.prototype.hasOwnProperty.call(
    capability?.argsSchema?.properties ?? {},
    name,
  );
}

export function partitionRunOptions(
  capability,
  options = {},
  { explicitBoundary = false } = {},
) {
  const capabilityArgs = { ...options };
  const knownAxOptions = new Set(Object.values(AXF_RUN_OPTIONS));
  const knownLegacyOptions = new Set(Object.values(LEGACY_RUN_OPTIONS));

  for (const name of Object.keys(capabilityArgs)) {
    if (isFrameworkReservedArgName(name) && !knownAxOptions.has(name)) {
      throw new AxError(`unknown AXF run option '--${name}'`, 2);
    }
    if (
      explicitBoundary &&
      !knownAxOptions.has(name) &&
      !knownLegacyOptions.has(name)
    ) {
      throw new AxError(
        `capability option '--${name}' must appear after the '--' boundary`,
        2,
      );
    }
  }

  const controls = {
    json: Boolean(capabilityArgs[AXF_RUN_OPTIONS.json]),
    allowAnyLifecycle: Boolean(
      capabilityArgs[AXF_RUN_OPTIONS.anyLifecycle],
    ),
    usedLegacyAllowDraft: false,
  };
  delete capabilityArgs[AXF_RUN_OPTIONS.json];
  delete capabilityArgs[AXF_RUN_OPTIONS.anyLifecycle];

  if (explicitBoundary) {
    controls.json =
      controls.json || Boolean(capabilityArgs[LEGACY_RUN_OPTIONS.json]);
    controls.allowAnyLifecycle =
      controls.allowAnyLifecycle ||
      Boolean(capabilityArgs[LEGACY_RUN_OPTIONS.anyLifecycle]) ||
      Boolean(capabilityArgs[LEGACY_RUN_OPTIONS.allowDraft]);
    controls.usedLegacyAllowDraft = Object.prototype.hasOwnProperty.call(
      capabilityArgs,
      LEGACY_RUN_OPTIONS.allowDraft,
    );
    return { capabilityArgs: {}, controls };
  }

  if (
    !capabilityDeclaresArgument(capability, LEGACY_RUN_OPTIONS.json) &&
    Object.prototype.hasOwnProperty.call(
      capabilityArgs,
      LEGACY_RUN_OPTIONS.json,
    )
  ) {
    controls.json = controls.json || Boolean(capabilityArgs.json);
    delete capabilityArgs.json;
  }

  if (
    !capabilityDeclaresArgument(
      capability,
      LEGACY_RUN_OPTIONS.anyLifecycle,
    ) &&
    Object.prototype.hasOwnProperty.call(
      capabilityArgs,
      LEGACY_RUN_OPTIONS.anyLifecycle,
    )
  ) {
    controls.allowAnyLifecycle =
      controls.allowAnyLifecycle ||
      Boolean(capabilityArgs[LEGACY_RUN_OPTIONS.anyLifecycle]);
    delete capabilityArgs[LEGACY_RUN_OPTIONS.anyLifecycle];
  }

  if (
    !capabilityDeclaresArgument(capability, LEGACY_RUN_OPTIONS.allowDraft) &&
    Object.prototype.hasOwnProperty.call(
      capabilityArgs,
      LEGACY_RUN_OPTIONS.allowDraft,
    )
  ) {
    controls.allowAnyLifecycle =
      controls.allowAnyLifecycle ||
      Boolean(capabilityArgs[LEGACY_RUN_OPTIONS.allowDraft]);
    controls.usedLegacyAllowDraft = true;
    delete capabilityArgs[LEGACY_RUN_OPTIONS.allowDraft];
  }

  return { capabilityArgs, controls };
}
