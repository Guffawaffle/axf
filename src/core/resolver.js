import { parseCapabilityInput } from "./path-model.js";
import { AxError } from "./errors.js";
import { assertValid } from "./schema-validator.js";
import { isFrameworkReservedArgName } from "./framework-options.js";

export function resolveCapability(registry, inputTokens, context = {}) {
    const inspected = registry.resolveInspectable(inputTokens);
    const capability = inspected.capability;
    const allowDraft = Boolean(context.allowDraft);

    if (capability.lifecycleState !== "active" && !allowDraft) {
        throw new AxError(
            `capability '${capability.id}' is ${capability.lifecycleState}; pass --any-lifecycle to run explicitly`,
            2
        );
    }

    // Merge defaults <- caller args (caller wins).
    const merged = {
        ...(capability.defaults ?? {}),
        ...(context.args ?? {})
    };

    for (const name of Object.keys(merged)) {
        if (isFrameworkReservedArgName(name)) {
            throw new AxError(
                `capability args cannot use the reserved '--${name}' AXF option namespace`,
                2
            );
        }
    }

    const validated = capability.argsSchema
        ? assertValid(capability.argsSchema, merged, `capability '${capability.id}' args`)
        : merged;

    return {
        input: parseCapabilityInput(registry, inputTokens),
        capability,
        args: validated,
        injectedDefaults: inspected.injectedDefaults
    };
}

export function synthesizeMountedCapability({
    toolspace,
    moduleName,
    mount,
    capabilityPath,
    sourceCapability
}) {
    return {
        ...sourceCapability,
        id: `toolspace.${toolspace.toolspace}.${moduleName}.${capabilityPath}`,
        scope: "toolspace-local",
        lifecycleState:
            mount.lifecycleState ??
            toolspace.lifecycleState ??
            sourceCapability.lifecycleState,
        defaults: {
            ...(sourceCapability.defaults ?? {}),
            ...(mount.defaults ?? {})
        },
        policies: [
            ...(sourceCapability.policies ?? []),
            ...(mount.policies ?? [])
        ],
        sourceCapabilityId: sourceCapability.id,
        mount: {
            toolspace: toolspace.toolspace,
            module: moduleName,
            source: mount.source,
            mode: mount.mode ?? "proxy"
        },
        manifestPath: toolspace.manifestPath
    };
}
