export interface Job {
  id: string,
  source: string,
  fn: () => Promise<void>
}
