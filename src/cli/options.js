import { AxError } from "../core/errors.js";

// Tokenization rules:
// - All tokens before the first --flag are path tokens.
// - --flag value     -> options.flag = "value"  (string by default)
// - --flag=value     -> options.flag = "value"  (string by default)
// - --flag           -> options.flag = true     (boolean)
// - "false" literal  -> options.flag = false    (only this one boolean coercion)
//
// We deliberately do NOT auto-coerce numeric strings here. Numeric and
// other typed coercion happens in the resolver, driven by the
// capability's argsSchema. This keeps CLI parsing predictable and
// pushes type knowledge to the place that owns it.

export function splitCommandTokens(tokens, { rejectDuplicates = false } = {}) {
    const pathTokens = [];
    const optionTokens = [];
    let sawOption = false;

    for (const token of tokens) {
        if (!sawOption && token.startsWith("--")) sawOption = true;
        if (sawOption) optionTokens.push(token);
        else pathTokens.push(token);
    }

    const parsed = parseOptionTokens(optionTokens, { rejectDuplicates });
    return {
        pathTokens,
        options: parsed.options,
        positionals: parsed.positionals
    };
}

export function splitRunTokens(tokens) {
    const boundaries = tokens
        .map((token, index) => (token === "--" ? index : -1))
        .filter((index) => index !== -1);

    if (boundaries.length > 1) {
        throw new AxError("run accepts at most one '--' argument boundary", 2);
    }

    const boundaryIndex = boundaries[0] ?? -1;
    const beforeBoundary = boundaryIndex === -1
        ? tokens
        : tokens.slice(0, boundaryIndex);
    const afterBoundary = boundaryIndex === -1
        ? []
        : tokens.slice(boundaryIndex + 1);
    const before = splitCommandTokens(beforeBoundary, {
        rejectDuplicates: boundaryIndex !== -1
    });

    if (before.positionals.length > 0) {
        throw new AxError(
            `unexpected positional run argument '${before.positionals[0]}'`,
            2
        );
    }

    const capability = parseOptionTokens(afterBoundary, {
        rejectDuplicates: boundaryIndex !== -1
    });
    if (capability.positionals.length > 0) {
        throw new AxError(
            `capability arguments after '--' must use --name value form; found '${capability.positionals[0]}'`,
            2
        );
    }

    return {
        pathTokens: before.pathTokens,
        frameworkOptions: before.options,
        boundaryOptions: capability.options,
        hasBoundary: boundaryIndex !== -1
    };
}

export function parseOptionTokens(tokens, { rejectDuplicates = false } = {}) {
    const options = {};
    const positionals = [];

    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];

        if (!token.startsWith("--")) {
            positionals.push(token);
            continue;
        }

        const normalized = token.slice(2);
        if (!normalized) {
            throw new AxError("empty option name", 2);
        }

        const equalsIndex = normalized.indexOf("=");
        if (equalsIndex !== -1) {
            const key = normalized.slice(0, equalsIndex);
            const value = normalized.slice(equalsIndex + 1);
            assertOptionNotDuplicate(options, key, rejectDuplicates);
            options[key] = parseLiteral(value);
            continue;
        }

        const next = tokens[index + 1];
        if (next === undefined || next.startsWith("--")) {
            assertOptionNotDuplicate(options, normalized, rejectDuplicates);
            options[normalized] = true;
            continue;
        }

        assertOptionNotDuplicate(options, normalized, rejectDuplicates);
        options[normalized] = parseLiteral(next);
        index += 1;
    }

    return { options, positionals };
}

function assertOptionNotDuplicate(options, key, rejectDuplicates) {
    if (rejectDuplicates && Object.prototype.hasOwnProperty.call(options, key)) {
        throw new AxError(
            `option '--${key}' appears more than once in the same argument section`,
            2
        );
    }
}

// Only the literal strings "true" and "false" are coerced to booleans;
// everything else is preserved as a string. Schema-driven coercion in
// the resolver handles numbers, integers, and explicit booleans.
function parseLiteral(value) {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
}
