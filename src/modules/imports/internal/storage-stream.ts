/**
 * `StorageProvider.readObject` (src/modules/storage/provider.ts) returns a
 * web `ReadableStream<Uint8Array>` (the DOM type — this repo's `tsconfig.json`
 * includes `"dom"` in `lib`), but `../internal/csv-stream.ts`'s readers take
 * a Node `Readable`. `node:stream`'s `Readable.fromWeb` exists for exactly
 * this, but expects `node:stream/web`'s `ReadableStream`, a structurally
 * near-identical but nominally distinct type from the DOM one — swapping
 * between them is exactly the kind of thing that invites a cast. Reading
 * the web stream by hand through its own `getReader()` API instead needs
 * no cast at all: the async generator below only ever touches the one
 * method (`read()`) both stream types actually share in practice.
 */
import { Readable } from "node:stream"

async function* readChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader()
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- a stream read is inherently sequential: each chunk can only be requested after the previous one resolves, there is nothing here to parallelize.
      const next = await reader.read()
      if (next.done) return
      yield next.value
    }
  } finally {
    reader.releaseLock()
  }
}

/** Adapts a `StorageProvider.readObject` result to the `Readable` the CSV framing module needs. */
export function toNodeReadable(stream: ReadableStream<Uint8Array>): Readable {
  return Readable.from(readChunks(stream))
}
