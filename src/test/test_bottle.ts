import { Decorate, Stream } from "ballvalve";
import { Bottle } from "../bottle";
import { setLogger } from "../debug";
import { Header } from "../header";
import { Readable } from "../readable";

import "should";
import "source-map-support/register";

const MAGIC_STRING = "f09f8dbc0000";
const BASIC_MAGIC = MAGIC_STRING + "00e09dcdda54";

const delay = (msec: number) => new Promise<void>(resolve => setTimeout(resolve, msec));

async function hex(s: Stream): Promise<string> {
  return Buffer.concat(await Decorate.asyncIterator(s).collect()).toString("hex");
}


describe("Bottle.write", () => {
  it("writes a bottle header", async () => {
    const b = Bottle.write(10, new Header().addInt(0, 150), Decorate.iterator([]));
    (await hex(b)).should.eql(`${MAGIC_STRING}03a0018096cc8641ed`);
  });

  it("writes data", async () => {
    const data = Decorate.iterator([ Buffer.from("ff00ff00", "hex") ]);
    const b = Bottle.write(10, new Header(), Decorate.iterator([ data ]));
    (await hex(b)).should.eql(`${MAGIC_STRING}00a00d8c062204ff00ff0000`);
  });

  it("writes a nested bottle", async () => {
    const b2 = Bottle.write(14, new Header(), Decorate.iterator([]));
    const b = Bottle.write(10, new Header(), Decorate.iterator([ b2 ]));
    (await hex(b)).should.eql(`${MAGIC_STRING}00a00d8c06220c${MAGIC_STRING}00e09dcdda5400`);
  });

  it("writes a nested bottle of data", async () => {
    const data = Decorate.iterator([ Buffer.from("cat") ]);
    const b2 = Bottle.write(14, new Header(), Decorate.iterator([ data ]));
    const b = Bottle.write(10, new Header(), Decorate.iterator([ b2 ]));

    const nested = `0c${MAGIC_STRING}00e09dcdda54010303636174010000`;
    (await hex(b)).should.eql(`${MAGIC_STRING}00a00d8c0622${nested}`);
  });

  it("streams data", async () => {
    // just to verify that the data is written as it comes in, and the event isn't triggered until completion.
    let done = false;
    async function* data(): Stream {
      await delay(10);
      yield Buffer.from("c44c", "hex");
      await delay(10);
      done = true;
    }

    const b = Bottle.write(14, new Header(), Decorate.iterator([ data() ]));
    done.should.eql(false);
    (await hex(b)).should.eql(`${MAGIC_STRING}00e09dcdda5402c44c00`);
    done.should.eql(true);
  });

  it("writes several datas", async () => {
    const data1 = Decorate.iterator([ Buffer.from("f0f0f0", "hex") ]);
    const data2 = Decorate.iterator([ Buffer.from("e0e0e0", "hex") ]);
    const data3 = Decorate.iterator([ Buffer.from("cccccc", "hex") ]);

    async function* streams(): AsyncIterator<Stream> {
      await delay(10);
      yield data1;
      await delay(10);
      yield data2;
      await delay(10);
      yield data3;
    }

    const b = Bottle.write(14, new Header(), streams());
    (await hex(b)).should.eql(`${MAGIC_STRING}00e09dcdda5403f0f0f00003e0e0e00003cccccc00`);
  });
});


describe("bottleReader", () => {
  function read(hex: string): Promise<Bottle> {
    return Bottle.read(new Readable(Decorate.iterator([ Buffer.from(hex, "hex") ])));
  }

  it("validates the header", async () => {
    await read("00").should.be.rejectedWith(/End of stream/);
    await read("00ff00ff00ff00ffcccccccc").should.be.rejectedWith(/magic/);
    await read("f09f8dbcff000000cccccccc").should.be.rejectedWith(/version/);
    await read("f09f8dbc00ff0000cccccccc").should.be.rejectedWith(/flags/);
    await read("f09f8dbc000000c0cccccccc").should.be.rejectedWith(/CRC/);
  });

  it("reads the header", async () => {
    const b = await read("f09f8dbc000000c055edb46f");
    b.cap.type.should.eql(12);
    b.cap.header.toString().should.eql("Header()");

    const b2 = await read("f09f8dbc000003e0018096f1de5576");
    b2.cap.type.should.eql(14);
    b2.cap.header.toString().should.eql("Header(I0=150)");
  });

  it("reads a data block", async () => {
    const b = await read(`${BASIC_MAGIC}0568656c6c6f00`);
    const stream1 = (await b.streams.next()).value;
    Buffer.concat(await Decorate.asyncIterator(stream1).collect()).toString().should.eql("hello");
    (await b.streams.next()).done.should.eql(true);
  });

  it("reads a continuing data block", async () => {
    const b = await read(`${BASIC_MAGIC}026865016c026c6f00`);
    const stream1 = (await b.streams.next()).value;
    Buffer.concat(await Decorate.asyncIterator(stream1).collect()).toString().should.eql("hello");
    (await b.streams.next()).done.should.eql(true);
  });

  it("reads several datas", async () => {
    const b = await read(`${BASIC_MAGIC}03f0f0f00003e0e0e00003cccccc00`);

    const stream1 = (await b.streams.next()).value;
    Buffer.concat(await Decorate.asyncIterator(stream1).collect()).toString("hex").should.eql("f0f0f0");

    const stream2 = (await b.streams.next()).value;
    Buffer.concat(await Decorate.asyncIterator(stream2).collect()).toString("hex").should.eql("e0e0e0");

    const stream3 = (await b.streams.next()).value;
    Buffer.concat(await Decorate.asyncIterator(stream3).collect()).toString("hex").should.eql("cccccc");

    (await b.streams.next()).done.should.eql(true);
  });

  it("reads nested bottles", async () => {
    const nested = `0c${MAGIC_STRING}00b0699cb13f05036361740000`;
    const b = await read(`${MAGIC_STRING}00a00d8c0622${nested}0362617400`);
    b.cap.type.should.eql(10);

    const stream1 = (await b.streams.next()).value;
    const b2 = await Bottle.read(new Readable(stream1));
    b2.cap.type.should.eql(11);

    const innerStream = (await b2.streams.next()).value;
    Buffer.concat(await Decorate.asyncIterator(innerStream).collect()).toString().should.eql("cat");

    (await b2.streams.next()).done.should.eql(true);

    const stream2 = (await b.streams.next()).value;
    Buffer.concat(await Decorate.asyncIterator(stream2).collect()).toString().should.eql("bat");
    (await b.streams.next()).done.should.eql(true);
  });
});
