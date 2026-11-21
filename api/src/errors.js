// Fachliche Fehler mit HTTP-Status und stabilem Fehlercode für die JSON-Antwort.
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Nicht gefunden') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ValidationError extends HttpError {
  constructor(details, message = 'Ungültige Anfrage') {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

// Fehler zu einem Feld des Formulars (z. B. Datei "cv") als Detail-Liste wie bei ValidationError.
function fieldDetails(field, message) {
  return field ? [{ location: 'body', field, message }] : undefined;
}

export class ConflictError extends HttpError {
  constructor(code, message) {
    super(409, code, message);
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor(message, field) {
    super(413, 'PAYLOAD_TOO_LARGE', message, fieldDetails(field, message));
  }
}

export class UnsupportedMediaTypeError extends HttpError {
  constructor(message, field) {
    super(415, 'UNSUPPORTED_MEDIA_TYPE', message, fieldDetails(field, message));
  }
}
