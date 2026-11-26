// Only errors raised at a known scene boundary are eligible for live continuation.
export class SceneStop extends Error {
  constructor(status, reason, responseUrl) {
    super(reason);
    this.status = status;
    this.responseUrl = responseUrl;
  }
}
