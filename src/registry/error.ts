export type RegistryErrorKind = "auth" | "not-found" | "network" | "schema" | "env";

export class RegistryError extends Error {
  readonly kind: RegistryErrorKind;
  readonly namespace: string;

  constructor(kind: RegistryErrorKind, namespace: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "RegistryError";
    this.kind = kind;
    this.namespace = namespace;
    this.cause = options?.cause;
  }
}
