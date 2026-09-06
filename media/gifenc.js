/*
 * gifenc.js — a small, self-contained animated-GIF encoder.
 *
 * VYUHA runs fully offline, so it cannot pull gif.js or any encoder off a CDN.
 * This is a from-scratch GIF89a writer: median-cut colour quantisation to a
 * 256-colour palette per frame, LZW compression, and the Netscape looping
 * extension. It is deliberately compact and dependency-free.
 *
 * Usage:
 *   var enc = new GifEncoder(width, height, { delayMs: 120, loop: true });
 *   enc.addFrame(uint8ClampedRGBA);   // one ImageData.data per frame
 *   var bytes = enc.finish();          // Uint8Array of a valid .gif
 *
 * The renderer captures each 3D frame with readPixels/toDataURL and feeds the
 * RGBA bytes here, so exactly what the user saw becomes the animation.
 */
(function (global) {
  'use strict';

  /* ── byte sink ─────────────────────────────────────────────── */
  function ByteBuffer() { this.b = []; }
  ByteBuffer.prototype.byte = function (v) { this.b.push(v & 0xff); };
  ByteBuffer.prototype.bytes = function (arr) { for (var i = 0; i < arr.length; i++) this.b.push(arr[i] & 0xff); };
  ByteBuffer.prototype.str = function (s) { for (var i = 0; i < s.length; i++) this.b.push(s.charCodeAt(i) & 0xff); };
  ByteBuffer.prototype.u16 = function (v) { this.b.push(v & 0xff, (v >> 8) & 0xff); };
  ByteBuffer.prototype.toUint8 = function () { return new Uint8Array(this.b); };

  /* ── median-cut quantiser (RGBA8 → ≤256 palette + indices) ─── */
  function quantize(rgba, maxColors) {
    // Collect unique-ish colours by 5-bit-per-channel bucketing to keep it fast.
    var buckets = {};
    var n = rgba.length / 4;
    var i, r, g, b, key;
    for (i = 0; i < n; i++) {
      r = rgba[i * 4]; g = rgba[i * 4 + 1]; b = rgba[i * 4 + 2];
      key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      var e = buckets[key];
      if (e) { e.c++; e.r += r; e.g += g; e.b += b; }
      else buckets[key] = { c: 1, r: r, g: g, b: b };
    }
    var boxesInput = [];
    for (key in buckets) {
      var bk = buckets[key];
      boxesInput.push({ r: bk.r / bk.c, g: bk.g / bk.c, b: bk.b / bk.c, count: bk.c });
    }
    // Median-cut down to maxColors boxes.
    var boxes = [boxesInput];
    while (boxes.length < maxColors) {
      // Pick the box with the greatest colour spread on any channel.
      var pick = -1, pickRange = -1, pickAxis = 'r';
      for (i = 0; i < boxes.length; i++) {
        var bx = boxes[i];
        if (bx.length < 2) continue;
        var lo = [255, 255, 255], hi = [0, 0, 0];
        for (var j = 0; j < bx.length; j++) {
          lo[0] = Math.min(lo[0], bx[j].r); hi[0] = Math.max(hi[0], bx[j].r);
          lo[1] = Math.min(lo[1], bx[j].g); hi[1] = Math.max(hi[1], bx[j].g);
          lo[2] = Math.min(lo[2], bx[j].b); hi[2] = Math.max(hi[2], bx[j].b);
        }
        var rng = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
        var mx = Math.max(rng[0], rng[1], rng[2]);
        if (mx > pickRange) { pickRange = mx; pick = i; pickAxis = rng[0] === mx ? 'r' : rng[1] === mx ? 'g' : 'b'; }
      }
      if (pick < 0) break;
      var box = boxes[pick];
      box.sort(function (a, c) { return a[pickAxis] - c[pickAxis]; });
      var mid = box.length >> 1;
      boxes.splice(pick, 1, box.slice(0, mid), box.slice(mid));
    }
    // Average each box to a palette entry.
    var palette = [];
    for (i = 0; i < boxes.length; i++) {
      var box2 = boxes[i], tr = 0, tg = 0, tb = 0, tc = 0;
      for (var k = 0; k < box2.length; k++) {
        tr += box2[k].r * box2[k].count;
        tg += box2[k].g * box2[k].count;
        tb += box2[k].b * box2[k].count;
        tc += box2[k].count;
      }
      tc = tc || 1;
      palette.push([Math.round(tr / tc), Math.round(tg / tc), Math.round(tb / tc)]);
    }
    while (palette.length < 2) palette.push([0, 0, 0]);
    // Nearest-palette index for every pixel (cached per 15-bit colour).
    var cache = {};
    var indices = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      r = rgba[i * 4]; g = rgba[i * 4 + 1]; b = rgba[i * 4 + 2];
      key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      var idx = cache[key];
      if (idx === undefined) {
        var best = 0, bestD = Infinity;
        for (j = 0; j < palette.length; j++) {
          var dr = palette[j][0] - r, dg = palette[j][1] - g, db = palette[j][2] - b;
          var d = dr * dr + dg * dg + db * db;
          if (d < bestD) { bestD = d; best = j; }
        }
        idx = cache[key] = best;
      }
      indices[i] = idx;
    }
    return { palette: palette, indices: indices };
  }

  /* ── LZW compression (GIF variant) ─────────────────────────── */
  function lzwEncode(minCodeSize, indices) {
    var out = new ByteBuffer();
    var clearCode = 1 << minCodeSize;
    var eoiCode = clearCode + 1;
    var codeSize = minCodeSize + 1;
    var dict = {};
    function resetDict() {
      dict = {};
      for (var i = 0; i < clearCode; i++) dict[String.fromCharCode(i)] = i;
    }
    resetDict();
    var next = eoiCode + 1;

    var bitBuffer = 0, bitCount = 0;
    var packet = [];
    function emit(code) {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        packet.push(bitBuffer & 0xff);
        bitBuffer >>= 8; bitCount -= 8;
        if (packet.length === 255) { out.byte(255); out.bytes(packet); packet = []; }
      }
    }

    emit(clearCode);
    var prefix = String.fromCharCode(indices[0]);
    for (var i = 1; i < indices.length; i++) {
      var ch = String.fromCharCode(indices[i]);
      if (dict[prefix + ch] !== undefined) {
        prefix += ch;
      } else {
        emit(dict[prefix]);
        dict[prefix + ch] = next++;
        if (next > (1 << codeSize) && codeSize < 12) codeSize++;
        else if (next > 4095) { emit(clearCode); resetDict(); next = eoiCode + 1; codeSize = minCodeSize + 1; }
        prefix = ch;
      }
    }
    emit(dict[prefix]);
    emit(eoiCode);
    // flush remaining bits
    if (bitCount > 0) { packet.push(bitBuffer & 0xff); }
    if (packet.length) { out.byte(packet.length); out.bytes(packet); }
    out.byte(0); // block terminator
    return out.toUint8();
  }

  /* ── the encoder ───────────────────────────────────────────── */
  function GifEncoder(width, height, opts) {
    opts = opts || {};
    this.w = width; this.h = height;
    this.delay = Math.max(2, Math.round((opts.delayMs || 120) / 10)); // GIF uses 1/100s
    this.loop = opts.loop !== false;
    this.frames = [];
  }
  GifEncoder.prototype.addFrame = function (rgba) {
    // Store a copy; quantise at finish so all frames are handled uniformly.
    this.frames.push(rgba.slice ? rgba.slice(0) : new Uint8ClampedArray(rgba));
  };
  GifEncoder.prototype.finish = function () {
    var buf = new ByteBuffer();
    buf.str('GIF89a');
    buf.u16(this.w); buf.u16(this.h);
    buf.byte(0x70);  // global flags: no global colour table, 8-bit colour resolution
    buf.byte(0);     // background colour index
    buf.byte(0);     // pixel aspect ratio

    if (this.loop) {
      buf.byte(0x21); buf.byte(0xff); buf.byte(11);
      buf.str('NETSCAPE2.0');
      buf.byte(3); buf.byte(1); buf.u16(0); // loop forever
      buf.byte(0);
    }

    for (var f = 0; f < this.frames.length; f++) {
      var q = quantize(this.frames[f], 256);
      var palette = q.palette, indices = q.indices;

      // Graphics control extension (per-frame delay)
      buf.byte(0x21); buf.byte(0xf9); buf.byte(4);
      buf.byte(0x04);              // disposal = restore to background off; no transparency
      buf.u16(this.delay);
      buf.byte(0); buf.byte(0);

      // Image descriptor
      buf.byte(0x2c);
      buf.u16(0); buf.u16(0);
      buf.u16(this.w); buf.u16(this.h);
      // local colour table, size = ceil(log2(len))-1
      var bits = Math.max(1, Math.ceil(Math.log(palette.length) / Math.LN2));
      var tableSize = 1 << bits;
      buf.byte(0x80 | (bits - 1));

      for (var i = 0; i < tableSize; i++) {
        if (i < palette.length) buf.bytes(palette[i]);
        else buf.bytes([0, 0, 0]);
      }

      var minCodeSize = Math.max(2, bits);
      buf.byte(minCodeSize);
      buf.bytes(lzwEncode(minCodeSize, indices));
    }

    buf.byte(0x3b); // trailer
    return buf.toUint8();
  };

  global.GifEncoder = GifEncoder;
})(typeof window !== 'undefined' ? window : this);
