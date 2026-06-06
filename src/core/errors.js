export class AxError extends Error {
  constructor(message, exitCode = 1, details = null) {
    super(message);
    this.name = "AxError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

export class UnknownCapabilityError extends AxError {
  constructor(message, details = null) {
    super(message, 2, details);
    this.name = "UnknownCapabilityError";
    this.code = "UNKNOWN_CAPABILITY";
  }
}
