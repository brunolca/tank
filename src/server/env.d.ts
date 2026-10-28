interface Env {
  ROOMS: DurableObjectNamespace<import('./room').Room>;
  ASSETS: Fetcher;
}
