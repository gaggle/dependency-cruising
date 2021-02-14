export interface Job {
  source: string,
  fn: () => Promise<void>
}
