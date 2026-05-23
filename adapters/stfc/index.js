// STFC provider adapter.
//
// The STFC provider script always returns:
//   { ok, command, timestamp, durationMs, data, error?, hints? }
//
// Keep that provider-specific envelope out of the generic cli adapter.

export async function execute(resolved, ctx) {
    const upstream = await ctx.typeAdapter.execute(resolved, ctx);

    if (!upstream.ok) {
        return upstream;
    }

    const envelope = upstream.data;
    if (!isStfcEnvelope(envelope)) {
        return {
            ok: false,
            error: {
                message: `stfc provider: '${resolved.capability.id}' did not return a recognizable STFC envelope`
            },
            meta: {
                ...(upstream.meta ?? {}),
                rawData: envelope
            }
        };
    }

    const meta = {
        ...(upstream.meta ?? {}),
        stfc: {
            command: envelope.command,
            timestamp: envelope.timestamp,
            durationMs: envelope.durationMs
        }
    };
    if (Array.isArray(envelope.hints) && envelope.hints.length > 0) {
        meta.hints = envelope.hints;
    }

    if (envelope.ok) {
        return {
            ok: true,
            data: envelope.data ?? null,
            meta
        };
    }

    return {
        ok: false,
        error: {
            message: envelope.error?.message ?? `stfc '${envelope.command}' reported failure with no error details`
        },
        meta: {
            ...meta,
            stfcError: envelope.error ?? null,
            data: envelope.data ?? null
        }
    };
}

function isStfcEnvelope(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        typeof value.command === "string" &&
        typeof value.ok === "boolean"
    );
}
