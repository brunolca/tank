interface Env {
  ROOMS: DurableObjectNamespace<import('./room').Room>;
  FEEDBACK: DurableObjectNamespace<import('./feedback').FeedbackStore>;
  ASSETS: Fetcher;
  FEEDBACK_TOKEN?: string;
}
