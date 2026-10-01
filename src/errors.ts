/** Base class for all errors thrown by this library. */
export class GmsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'GmsError';
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** The API responded with a non-2xx status. */
export class GmsHttpError extends GmsError {
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(status: number, url: string, body: string) {
    super(`GMS API request failed with HTTP ${status}${status === 504 ? ' (timeout)' : ''}: ${url}`);
    this.name = 'GmsHttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }

  /** True for 404, which the API returns for unknown IDs. */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** The request could not be completed (network failure, timeout, abort). */
export class GmsNetworkError extends GmsError {
  readonly url: string;

  constructor(url: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`GMS API request failed: ${reason} (${url})`, { cause });
    this.name = 'GmsNetworkError';
    this.url = url;
  }
}

/** The API returned a body that was not valid JSON. */
export class GmsParseError extends GmsError {
  readonly url: string;

  constructor(url: string, cause: unknown) {
    super(`GMS API returned invalid JSON: ${url}`, { cause });
    this.name = 'GmsParseError';
    this.url = url;
  }
}
