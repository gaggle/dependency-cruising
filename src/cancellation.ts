import AbortController from 'node-abort-controller'

export const cancelController = new AbortController()
export const cancelSignal = cancelController.signal

export function cancelCheck (): void {
  if (cancelSignal.aborted) throw new Error('dependency-cruising cancelled')
}

export function cancel (): void {
  cancelController.abort()
  console.log('cancel controller triggered')
}
