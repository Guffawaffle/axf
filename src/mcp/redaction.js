const REDACTED_VALUE = "[REDACTED]";

const SENSITIVE_FIELD_NAMES = new Set([
  "apikey",
  "apitoken",
  "auth",
  "authorization",
  "bearertoken",
  "clientsecret",
  "connection",
  "connectionstring",
  "cookie",
  "credential",
  "credentials",
  "databaseurl",
  "dsn",
  "env",
  "environment",
  "password",
  "passwd",
  "passphrase",
  "privatekey",
  "pwd",
  "refreshtoken",
  "secret",
  "secretaccesskey",
  "secrets",
  "setcookie",
  "token",
]);

const SENSITIVE_FIELD_SUFFIXES = Object.freeze([
  "apikey",
  "accesskey",
  "connection",
  "credential",
  "passphrase",
  "password",
  "passwd",
  "privatekey",
  "secret",
  "token",
]);

const SENSITIVE_SCHEMA_VALUE_FIELDS = new Set([
  "default",
  "example",
  "examples",
]);

const SERIALIZED_JSON_MEMBER_PATTERN =
  /((?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*:\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gu;

const SENSITIVE_HEADER_PATTERN =
  /(^|[\r\n])([ \t]*(?:authorization|proxy-authorization|cookie|set-cookie|x[-_ ]?api[-_ ]?key|x[-_ ]?auth[-_ ]?token)\s*:\s*)[^\r\n]*/giu;

export function redactMcpResponse(projected, source = projected) {
  return redactValue(projected, collectSensitiveValues(source));
}

function collectSensitiveValues(value, collected = new Set(), path = []) {
  if (value === null || value === undefined) return collected;

  if (Array.isArray(value)) {
    for (const item of value) collectSensitiveValues(item, collected, path);
    return collected;
  }

  if (!isRecord(value)) return collected;

  for (const [key, fieldValue] of Object.entries(value)) {
    if (isCapabilityData(path, key)) continue;
    if (isSensitiveArgumentSchemaValue(path, key)) {
      collectScalarStrings(fieldValue, collected);
      continue;
    }
    if (!isArgumentSchemaProperty(path) && isSensitiveField(key)) {
      collectScalarStrings(fieldValue, collected);
      continue;
    }
    collectSensitiveValues(fieldValue, collected, [...path, key]);
  }

  return collected;
}

function collectScalarStrings(value, collected) {
  if (typeof value === "string" && value.length > 0) {
    collected.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectScalarStrings(item, collected);
    return;
  }
  if (isRecord(value)) {
    for (const fieldValue of Object.values(value)) {
      collectScalarStrings(fieldValue, collected);
    }
  }
}

function redactValue(value, sensitiveValues, path = []) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return redactString(value, sensitiveValues);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, sensitiveValues, path));
  }
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => {
      if (isCapabilityData(path, key)) return [key, fieldValue];
      if (isSensitiveArgumentSchemaValue(path, key)) {
        return [key, REDACTED_VALUE];
      }
      if (!isArgumentSchemaProperty(path) && isSensitiveField(key)) {
        return [key, REDACTED_VALUE];
      }
      return [
        key,
        redactValue(fieldValue, sensitiveValues, [...path, key]),
      ];
    }),
  );
}

function redactString(value, sensitiveValues) {
  let redacted = value
    .replace(/\b(Bearer|Basic)\s+\S+/giu, `$1 ${REDACTED_VALUE}`)
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@\s]+@/giu,
      `$1${REDACTED_VALUE}@`,
    )
    .replace(
      /(\b(?:api[_ -]?key|connection[_ -]?string|passphrase|passw(?:or)?d|pwd|secret(?:[_ -]?access[_ -]?key)?|token)\s*=\s*)("(?:""|[^"])*"|'(?:''|[^'])*'|\{[^}]*\}|[^;,\s]+)/giu,
      `$1${REDACTED_VALUE}`,
    )
    .replace(
      SERIALIZED_JSON_MEMBER_PATTERN,
      (match, prefix, doubleQuotedKey, singleQuotedKey, serializedValue) =>
        isSensitiveField(doubleQuotedKey ?? singleQuotedKey)
          ? `${prefix}${serializedValue[0]}${REDACTED_VALUE}${serializedValue.at(-1)}`
          : match,
    )
    .replace(
      SENSITIVE_HEADER_PATTERN,
      (_, lineBoundary, prefix) =>
        `${lineBoundary}${prefix}${REDACTED_VALUE}`,
    );

  for (const sensitiveValue of [...sensitiveValues].sort(
    (left, right) => right.length - left.length,
  )) {
    redacted = redactSensitiveValue(redacted, sensitiveValue);
  }

  return redacted;
}

function redactSensitiveValue(value, sensitiveValue) {
  if (value === sensitiveValue) return REDACTED_VALUE;
  if (sensitiveValue.length >= 4) {
    return value.split(sensitiveValue).join(REDACTED_VALUE);
  }

  const escaped = sensitiveValue.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return value.replace(
    new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gu"),
    REDACTED_VALUE,
  );
}

function isSensitiveField(field) {
  const normalized = field.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return (
    SENSITIVE_FIELD_NAMES.has(normalized) ||
    SENSITIVE_FIELD_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function isCapabilityData(path, field) {
  return path.length === 0 && field === "data";
}

function isArgumentSchemaProperty(path) {
  return path.at(-1) === "properties" && path.includes("argsSchema");
}

function isSensitiveArgumentSchemaValue(path, field) {
  return (
    path.at(-2) === "properties" &&
    path.includes("argsSchema") &&
    isSensitiveField(path.at(-1) ?? "") &&
    SENSITIVE_SCHEMA_VALUE_FIELDS.has(field)
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
