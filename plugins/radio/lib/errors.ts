type ErrorCode =
  "invalid_input" | "not_found" | "conflict" | "forbidden" | "ambiguous";
export class RadioError extends Error {
  readonly code: ErrorCode;
  readonly choices: string[];
  constructor(code: ErrorCode, message: string, choices: string[] = []) {
    super(message);
    this.name = "RadioError";
    this.code = code;
    this.choices = choices;
  }
}
