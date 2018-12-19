import { Decorate } from "ballvalve";
import { buffered } from "../buffered";
import { framed, unframed } from "../framed";
import { Readable } from "../readable";

import "should";
import "source-map-support/register";

describe("framed", () => {
  it("writes a small frame", async () => {
    const stream = Decorate.iterator([ Buffer.from([ 1, 2, 3 ]) ]);
    Buffer.concat(await Decorate.asyncIterator(framed(stream)).collect()).toString("hex").should.eql("0301020300");
  });

  it("buffers up a frame", async () => {
    const stream = Decorate.iterator([ "he", "ll", "o sai", "lor" ].map(s => Buffer.from(s)));
    Buffer.concat(await Decorate.asyncIterator(framed(buffered(stream))).collect()).toString("hex").should.eql(
      "0c68656c6c6f207361696c6f7200"
    );
  });

  it("ignores empty buffers", async () => {
    const stream = Decorate.iterator([ Buffer.from("he"), Buffer.alloc(0), Buffer.from("llo") ]);
    Buffer.concat(await Decorate.asyncIterator(framed(stream)).collect()).toString("hex").should.eql(
      "026865036c6c6f00"
    );
  })

  it("writes a power-of-two frame", async () => {
    for (const blockSize of [ 128, 1024, Math.pow(2, 18), Math.pow(2, 21) ]) {
      const stream = Decorate.iterator([ Buffer.alloc(blockSize) ]);
      const data = Buffer.concat(await Decorate.asyncIterator(framed(stream)).collect());
      data.length.should.eql(blockSize + 2);
      data[0].should.eql((Math.log(blockSize) / Math.log(2)) + 0xe0 - 7);
      data[data.length - 1].should.eql(0);
    }
  });

  it("writes a medium (< 16K) frame", async () => {
    for (const blockSize of [ 129, 1234, 8191, 15000 ]) {
      const stream = Decorate.iterator([ Buffer.alloc(blockSize) ]);
      const data = Buffer.concat(await Decorate.asyncIterator(framed(stream)).collect());
      data.length.should.eql(blockSize + 3);
      data[0].should.eql((blockSize & 0x3f) | 0x80);
      data[1].should.eql(blockSize >> 6);
      data[data.length - 1].should.eql(0);
    }
  });

  it("writes a large (< 2M) frame", async () => {
    for (const blockSize of [ 16385, 123456, 1456123 ]) {
      const stream = Decorate.iterator([ Buffer.alloc(blockSize) ]);
      const data = Buffer.concat(await Decorate.asyncIterator(framed(stream)).collect());
      data.length.should.eql(blockSize + 4);
      data[0].should.eql((blockSize & 0x1f) + 0xc0);
      data[1].should.eql((blockSize >> 5) & 0xff);
      data[2].should.eql((blockSize >> 13));
      data[data.length - 1].should.eql(0);
    }
  });
});

describe("unframed", () => {
  it("reads a simple frame", async () => {
    const stream = Decorate.iterator([ Buffer.from("0301020300", "hex") ]);
    Buffer.concat(await Decorate.asyncIterator(unframed(new Readable(stream))).collect()).toString("hex").should.eql("010203");
  });

  it("reads a block of many frames", async () => {
    const stream = Decorate.iterator([ Buffer.from("0468656c6c056f20736169036c6f7200", "hex") ]);
    Buffer.concat(await Decorate.asyncIterator(unframed(new Readable(stream))).collect()).toString().should.eql("hello sailor");
  });

  it("reads a power-of-two frame", async () => {
    for (const blockSize of [ 128, 1024, Math.pow(2, 18), Math.pow(2, 21) ]) {
      const b = Buffer.alloc(blockSize + 2);
      b[0] = 0xe0 + (Math.log(blockSize) / Math.log(2)) - 7;
      const stream = Decorate.iterator([ b ]);
      Buffer.concat(await Decorate.asyncIterator(unframed(new Readable(stream))).collect()).length.should.eql(blockSize);
    }
  });

  it("reads a medium (< 16K) frame", async () => {
    for (const blockSize of [ 129, 1234, 8191, 15000 ]) {
      const b = Buffer.alloc(blockSize + 3);
      b[0] = 0x80 + (blockSize & 0x3f);
      b[1] = blockSize >> 6;
      const stream = Decorate.iterator([ b ]);
      Buffer.concat(await Decorate.asyncIterator(unframed(new Readable(stream))).collect()).length.should.eql(blockSize);
    }
  });

  it("reads a large (< 2M) frame", async () => {
    for (const blockSize of [ 16385, 123456, 1456123 ]) {
      const b = Buffer.alloc(blockSize + 4);
      b[0] = 0xc0 + (blockSize & 0x1f);
      b[1] = (blockSize >> 5) & 0xff;
      b[2] = blockSize >> 13;
      const stream = Decorate.iterator([ b ]);
      Buffer.concat(await Decorate.asyncIterator(unframed(new Readable(stream))).collect()).length.should.eql(blockSize);
    }
  });
});
