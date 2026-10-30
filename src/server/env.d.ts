interface Env {
  ROOMS: DurableObjectNamespace<import('./room').Room>;
  FEEDBACK: DurableObjectNamespace<import('./feedback').FeedbackStore>;
  BOARD: DurableObjectNamespace<import('./board').Board>;
  ASSETS: Fetcher;
  FEEDBACK_TOKEN?: string;
}
