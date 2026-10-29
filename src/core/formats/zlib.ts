/*
  zlib streams, through the platform's DecompressionStream and CompressionStream ("deflate"
  is zlib-wrapped deflate). Both exist in browsers, in workers and in Node, with no DOM.
*/

async function run(bytes: Uint8Array, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> }): Promise<Uint8Array> {
  const out = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(bytes as BufferSource);
  await writer.close();
  return new Uint8Array(await out);
}

export function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return run(bytes, new DecompressionStream("deflate") as unknown as { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> });
}

export function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return run(bytes, new CompressionStream("deflate") as unknown as { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> });
}
