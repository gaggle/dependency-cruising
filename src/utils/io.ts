import { Readable } from 'stream'

export async function streamToBuffer (stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const data: Uint8Array[] = []

    stream.on('data', (chunk) => {
      data.push(chunk)
    })

    stream.on('end', () => {
      resolve(Buffer.concat(data))
    })

    stream.on('error', (err) => {
      reject(err)
    })
  })
}
