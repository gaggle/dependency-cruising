export interface Job {
  id: string,
  fn: () => Promise<void>
}
