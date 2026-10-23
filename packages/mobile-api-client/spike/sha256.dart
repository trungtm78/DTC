import 'dart:typed_data';

const List<int> _roundConstants = <int>[
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, //
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const int _mask = 0xffffffff;

int _rotr(int value, int bits) => ((value >>> bits) | (value << (32 - bits))) & _mask;

/// SHA-256 of [data] (FIPS 180-4), on the 64-bit integers of the Dart VM. The spike keeps it dependency free; the
/// product app uses the platform digest.
Uint8List sha256(List<int> data) {
  final int paddedLength = ((data.length + 9 + 63) ~/ 64) * 64;
  final Uint8List padded = Uint8List(paddedLength)
    ..setRange(0, data.length, data)
    ..[data.length] = 0x80;
  final ByteData view = ByteData.sublistView(padded);
  final int bitLength = data.length * 8;
  view.setUint32(paddedLength - 8, bitLength >>> 32);
  view.setUint32(paddedLength - 4, bitLength & _mask);

  final List<int> h = <int>[0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  final Uint32List w = Uint32List(64);
  for (int offset = 0; offset < paddedLength; offset += 64) {
    for (int t = 0; t < 16; t += 1) {
      w[t] = view.getUint32(offset + t * 4);
    }
    for (int t = 16; t < 64; t += 1) {
      final int s0 = _rotr(w[t - 15], 7) ^ _rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      final int s1 = _rotr(w[t - 2], 17) ^ _rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & _mask;
    }
    int a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (int t = 0; t < 64; t += 1) {
      final int sum1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
      final int choose = (e & f) ^ (~e & _mask & g);
      final int temp1 = (hh + sum1 + choose + _roundConstants[t] + w[t]) & _mask;
      final int sum0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
      final int majority = (a & b) ^ (a & c) ^ (b & c);
      final int temp2 = (sum0 + majority) & _mask;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) & _mask;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & _mask;
    }
    h[0] = (h[0] + a) & _mask;
    h[1] = (h[1] + b) & _mask;
    h[2] = (h[2] + c) & _mask;
    h[3] = (h[3] + d) & _mask;
    h[4] = (h[4] + e) & _mask;
    h[5] = (h[5] + f) & _mask;
    h[6] = (h[6] + g) & _mask;
    h[7] = (h[7] + hh) & _mask;
  }
  final ByteData out = ByteData(32);
  for (int i = 0; i < 8; i += 1) {
    out.setUint32(i * 4, h[i]);
  }
  return out.buffer.asUint8List();
}

/// Lower-case hexadecimal SHA-256, the form the server records and compares.
String sha256Hex(List<int> data) => sha256(data).map((int byte) => byte.toRadixString(16).padLeft(2, '0')).join();
