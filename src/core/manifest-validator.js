// Manifest validators shared by the registry (load-time strict validation)
// and the doctor (post-load reporting). Returns issues with severity:
// "error" blocks loading in strict mode; "warning" never blocks.

const REQUIRED_CAPABILITY_FIELDS = [
    "manifestVersion",
    "id",
    "summary",
    "provider",
    "adapterType",
    "executionTarget",
    "argsSchema",
    "outputModes",
    "sideEffects",
    "scope",
    "lifecycleState",
    "defaults",
    "policies",
    "owner"
];

const REQUIRED_TOOLSPACE_FIELDS = [
    "manifestVersion",
    "toolspace",
    "lifecycleState",
    "moduleMounts"
];

const SUPPORTED_MANIFEST_VERSIONS = new Set(["axf/v0"]);
const LIFECYCLE_STATES = new Set(["draft", "reviewed", "active"]);
const ADAPTER_TYPES = new Set(["internal", "cli", "library", "rpc", "mcp"]);
const SCOPES = new Set(["global", "toolspace-local", "workspace-local"]);
const SIDE_EFFECTS = new Set(["none", "read", "write", "network", "unknown"]);
const MOUNT_MODES = new Set(["proxy", "wrap", "narrow"]);
const FQ_ID = /^(global|toolspace|workspace)\.[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

export function validateCapabilityManifest(manifest, label) {
    const issues = [];

    for (const field of REQUIRED_CAPABILITY_FIELDS) {
        if (!(field in manifest)) {
            issues.push({
                severity: "error",
                message: `${label}: capability missing '${field}'`
            });
        }
    }

    if (
        manifest.manifestVersion &&
        !SUPPORTED_MANIFEST_VERSIONS.has(manifest.manifestVersion)
    ) {
        issues.push({
            severity: "error",
            message: `${label}: unsupported manifestVersion '${manifest.manifestVersion}'`
        });
    }

    if (manifest.id && !FQ_ID.test(manifest.id)) {
        issues.push({
            severity: "error",
            message: `${label}: id '${manifest.id}' is not fully qualified (e.g. global.echo.say)`
        });
    }

    if (manifest.lifecycleState && !LIFECYCLE_STATES.has(manifest.lifecycleState)) {
        issues.push({
            severity: "error",
            message: `${label}: invalid lifecycleState '${manifest.lifecycleState}'`
        });
    }

    if (manifest.adapterType && !ADAPTER_TYPES.has(manifest.adapterType)) {
        issues.push({
            severity: "error",
            message: `${label}: invalid adapterType '${manifest.adapterType}'`
        });
    }

    if (
        manifest.providerAdapter !== undefined &&
        (typeof manifest.providerAdapter !== "string" ||
            !/^[a-z][a-z0-9-]*$/.test(manifest.providerAdapter))
    ) {
        issues.push({
            severity: "error",
            message: `${label}: providerAdapter must be a kebab-case name string`
        });
    }

    if (manifest.scope && !SCOPES.has(manifest.scope)) {
        issues.push({
            severity: "error",
            message: `${label}: invalid scope '${manifest.scope}'`
        });
    }

    // Cross-check: id prefix should match scope.
    if (manifest.id && manifest.scope) {
        const prefix = manifest.id.split(".")[0];
        if (manifest.scope === "global" && prefix !== "global") {
            issues.push({
                severity: "error",
                message: `${label}: scope=global but id starts with '${prefix}.'`
            });
        }
        if (manifest.scope === "workspace-local" && prefix !== "workspace") {
            issues.push({
                severity: "error",
                message: `${label}: scope=workspace-local but id starts with '${prefix}.' (expected 'workspace.')`
            });
        }
        if (manifest.scope === "toolspace-local" && prefix !== "toolspace") {
            issues.push({
                severity: "error",
                message: `${label}: scope=toolspace-local but id starts with '${prefix}.' (expected 'toolspace.')`
            });
        }
    }

    if (manifest.sideEffects && !SIDE_EFFECTS.has(manifest.sideEffects)) {
        issues.push({
            severity: "warning",
            message: `${label}: sideEffects '${manifest.sideEffects}' is non-standard`
        });
    }

    if (manifest.outputModes && !Array.isArray(manifest.outputModes)) {
        issues.push({
            severity: "error",
            message: `${label}: outputModes must be an array`
        });
    }

    if (manifest.policies && !Array.isArray(manifest.policies)) {
        issues.push({
            severity: "error",
            message: `${label}: policies must be an array`
        });
    }

    if (
        manifest.argsSchema &&
        (typeof manifest.argsSchema !== "object" || Array.isArray(manifest.argsSchema))
    ) {
        issues.push({
            severity: "error",
            message: `${label}: argsSchema must be an object`
        });
    }

    if (manifest.defaults && typeof manifest.defaults !== "object") {
        issues.push({
            severity: "error",
            message: `${label}: defaults must be an object`
        });
    }

    // Adapter-specific executionTarget shape.
    if (manifest.executionTarget && typeof manifest.executionTarget === "object") {
        if (manifest.adapterType === "internal" && !manifest.executionTarget.handler) {
            issues.push({
                severity: "error",
                message: `${label}: internal adapter requires executionTarget.handler`
            });
        }
        if (manifest.adapterType === "cli") {
            const hasCommand = typeof manifest.executionTarget.command === "string";
            const hasTargetPath =
                typeof manifest.executionTarget.target?.path === "string";
            if (!hasCommand && !hasTargetPath) {
                issues.push({
                    severity: "error",
                    message: `${label}: cli adapter requires executionTarget.command or executionTarget.target.path`
                });
            }
            if (
                manifest.executionTarget.target !== undefined &&
                (typeof manifest.executionTarget.target !== "object" ||
                    Array.isArray(manifest.executionTarget.target) ||
                    typeof manifest.executionTarget.target.path !== "string")
            ) {
                issues.push({
                    severity: "error",
                    message: `${label}: cli adapter executionTarget.target.path must be a string when target is declared`
                });
            }
            if (
                manifest.executionTarget.launcher !== undefined &&
                (typeof manifest.executionTarget.launcher !== "object" ||
                    Array.isArray(manifest.executionTarget.launcher) ||
                    typeof manifest.executionTarget.launcher.command !== "string")
            ) {
                issues.push({
                    severity: "error",
                    message: `${label}: cli adapter executionTarget.launcher.command must be a string when launcher is declared`
                });
            }
            if (manifest.executionTarget.cwd !== undefined) {
                const cwd = manifest.executionTarget.cwd;
                const validString = typeof cwd === "string";
                const validObject =
                    typeof cwd === "object" &&
                    !Array.isArray(cwd) &&
                    typeof cwd.path === "string" &&
                    (cwd.relativeTo === undefined ||
                        cwd.relativeTo === "workspace" ||
                        cwd.relativeTo === "process");
                if (!validString && !validObject) {
                    issues.push({
                        severity: "error",
                        message: `${label}: cli adapter executionTarget.cwd must be a string or { path, relativeTo } object`
                    });
                }
            }
        }
    }

    return issues;
}

export function validateToolspaceManifest(manifest, label) {
    const issues = [];

    for (const field of REQUIRED_TOOLSPACE_FIELDS) {
        if (!(field in manifest)) {
            issues.push({
                severity: "error",
                message: `${label}: toolspace missing '${field}'`
            });
        }
    }

    if (
        manifest.manifestVersion &&
        !SUPPORTED_MANIFEST_VERSIONS.has(manifest.manifestVersion)
    ) {
        issues.push({
            severity: "error",
            message: `${label}: unsupported manifestVersion '${manifest.manifestVersion}'`
        });
    }

    if (manifest.toolspace && !/^[a-z][a-z0-9-]*$/.test(manifest.toolspace)) {
        issues.push({
            severity: "error",
            message: `${label}: toolspace name '${manifest.toolspace}' must match /^[a-z][a-z0-9-]*$/`
        });
    }

    if (manifest.lifecycleState && !LIFECYCLE_STATES.has(manifest.lifecycleState)) {
        issues.push({
            severity: "error",
            message: `${label}: invalid lifecycleState '${manifest.lifecycleState}'`
        });
    }

    if (
        manifest.moduleMounts &&
        (typeof manifest.moduleMounts !== "object" || Array.isArray(manifest.moduleMounts))
    ) {
        issues.push({
            severity: "error",
            message: `${label}: moduleMounts must be an object`
        });
        return issues;
    }

    for (const [moduleName, mount] of Object.entries(manifest.moduleMounts ?? {})) {
        if (!mount.source) {
            issues.push({
                severity: "error",
                message: `${label}: mount '${moduleName}' missing 'source'`
            });
        }
        if (mount.mode && !MOUNT_MODES.has(mount.mode)) {
            issues.push({
                severity: "error",
                message: `${label}: mount '${moduleName}' has invalid mode '${mount.mode}'`
            });
        }
        if (mount.capabilities && !Array.isArray(mount.capabilities)) {
            issues.push({
                severity: "error",
                message: `${label}: mount '${moduleName}' capabilities must be an array`
            });
        }
    }

    return issues;
}

export {
    REQUIRED_CAPABILITY_FIELDS,
    REQUIRED_TOOLSPACE_FIELDS,
    LIFECYCLE_STATES,
    ADAPTER_TYPES,
    SCOPES,
    SIDE_EFFECTS,
    MOUNT_MODES,
    SUPPORTED_MANIFEST_VERSIONS,
    FQ_ID
};
