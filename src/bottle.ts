import { asyncIter, ByteReader } from "ballvalve";
import { BottleCap } from "./bottle_cap";
import { framed, unframed } from "./framed";

// frame headers 40, 80, c0 are reserved, so use them for out-of-band signalling.
const STREAM_RAW = 0x40;
const STREAM_BOTTLE = 0x80;
const STREAM_END = 0xc0;

let counter = 0;


export class Bottle {
  streamCount = 0;
  finished: Promise<void>;

  constructor(public cap: BottleCap, public streams: AsyncIterator<AsyncIterator<Buffer> | Bottle>) {
    const [ s, done ] = asyncIter(streams).withPromiseAfter();
    this.finished = done;
    this.streams = s;
  }

  toString(): string {
    return `Bottle(${this.cap}, read=${this.streamCount}, finished=${this.finished})`;
  }

  async nextStream(): Promise<AsyncIterator<Buffer> | Bottle | undefined> {
    const item = await this.streams.next();
    if (item.done) return undefined;
    this.streamCount++;
    return item.value;
  }

  async nextDataStream(): Promise<AsyncIterator<Buffer>> {
    const stream = await this.nextStream();
    if (stream === undefined) throw new Error("Expected stream, reached end");
    if (stream instanceof Bottle) throw new Error("Expected stream, got nested bottle");
    return stream;
  }

  async nextBottle(): Promise<Bottle> {
    const stream = await this.nextStream();
    if (stream === undefined) throw new Error("Expected stream, reached end");
    if (!(stream instanceof Bottle)) throw new Error("Expected nested bottle, got stream");
    return stream;
  }

  // we think the bottle is done, so finish it.
  async done(): Promise<void> {
    const stream = await this.nextStream();
    if (stream !== undefined) throw new Error("Expected end of bottle");
  }

  async* write(blockSize?: number): AsyncIterator<Buffer> {
    yield this.cap.write();
    for await (const s of asyncIter(this.streams)) {
      if (s instanceof Bottle) {
        yield Buffer.from([ STREAM_BOTTLE ]);
        yield* asyncIter(s.write(blockSize));
      } else {
        // raw stream
        yield Buffer.from([ STREAM_RAW ]);
        yield* asyncIter(framed(s, blockSize));
      }
    }
    yield Buffer.from([ STREAM_END ]);
  }

  static async read(stream: ByteReader): Promise<Bottle> {
    const id = ++counter;
    const cap = await BottleCap.read(stream);

    const streams = asyncIter(async function* () {
      while (true) {
        const marker = await stream.read(1);
        if (marker === undefined || marker.length < 1) throw new Error("Truncated bottle");
        switch (marker[0]) {
          case STREAM_RAW: {
            // need to wait for the stream to finish before reading the next one
            const [ inner, done ] = unframed(stream).withPromiseAfter();
            yield inner;
            await done;
            break;
          }
          case STREAM_BOTTLE: {
            const inner = await Bottle.read(stream);
            yield inner;
            await inner.finished;
            break;
          }
          case STREAM_END:
            return;
          default:
            throw new Error(`Stray byte 0x${marker[0].toString(16)} at position ${stream.bytesRead}`);
        }
      }
    }(), () => `BottleReader[${id}](${cap}, ${stream})`);

    return new Bottle(cap, streams);
  }
}
