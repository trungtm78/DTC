import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

import '../../spike/resumable_upload.dart';
import '../../spike/sha256.dart';

const int megabyte = 1024 * 1024;

/// Byte i of the source is (i * 31 + 7) mod 256; the digest below was computed independently with Node.
const String sourceDigest = 'e3b046bf0ea2077452156b5e6b6dee1ec24a438117d39c58a266d94af481521f';

Uint8List source() => Uint8List.fromList(List<int>.generate(12 * megabyte, (int i) => (i * 31 + 7) & 0xff));

/// Keeps the chunks it receives and can cut the network when a given chunk (0-based) is sent for the first time.
final class FakeUploadServer implements ChunkUploadServer {
  FakeUploadServer({this.cutAtChunk});

  final int? cutAtChunk;
  bool cut = false;
  final Map<int, Uint8List> stored = <int, Uint8List>{};
  final List<int> sends = <int>[];
  String? completedDigest;

  @override
  Future<String> begin({required int totalBytes, required int chunkSize}) async => 'upload-1';

  @override
  Future<Set<int>> received(String uploadId) async => stored.keys.toSet();

  @override
  Future<void> putChunk(String uploadId, int index, Uint8List bytes) async {
    sends.add(index);
    if (index == cutAtChunk && !cut) {
      cut = true;
      throw StateError('network lost');
    }
    stored[index] = Uint8List.fromList(bytes);
  }

  @override
  Future<void> complete(String uploadId, String sha256Hex) async {
    final BytesBuilder joined = BytesBuilder();
    for (final int index in (stored.keys.toList()..sort())) {
      joined.add(stored[index]!);
    }
    final String actual = sha256HexOf(joined.toBytes());
    if (actual != sha256Hex) throw StateError('digest mismatch');
    completedDigest = actual;
  }
}

String sha256HexOf(Uint8List bytes) => sha256Hex(bytes);

void main() {
  test('resumes after the network is cut at chunk 7 without re-sending chunks 1 to 6, and the final SHA-256 equals the source', () async {
    final Uint8List file = source();
    expect(sha256Hex(file), sourceDigest);
    final FakeUploadServer server = FakeUploadServer(cutAtChunk: 6);
    final ResumableUploader uploader = ResumableUploader(server);

    final String id = await uploader.begin(file);
    await expectLater(uploader.run(file, id), throwsStateError);
    expect(server.sends, <int>[0, 1, 2, 3, 4, 5, 6]);
    expect(server.stored.keys.toList()..sort(), <int>[0, 1, 2, 3, 4, 5]);

    await uploader.run(file, id);
    expect(server.sends, <int>[0, 1, 2, 3, 4, 5, 6, 6, 7, 8, 9, 10, 11]);
    expect(server.completedDigest, sourceDigest);
    for (int chunk = 0; chunk < 6; chunk += 1) {
      expect(server.sends.where((int sent) => sent == chunk), hasLength(1), reason: 'chunk ${chunk + 1} was sent once');
    }
  });

  test('uploads in one run when the network holds, and sends a short last chunk', () async {
    final Uint8List file = Uint8List.fromList(List<int>.generate(2 * megabyte + 5, (int i) => i & 0xff));
    final FakeUploadServer server = FakeUploadServer();
    final ResumableUploader uploader = ResumableUploader(server);
    await uploader.run(file, await uploader.begin(file));
    expect(server.sends, <int>[0, 1, 2]);
    expect(server.stored[2], hasLength(5));
    expect(server.completedDigest, sha256Hex(file));
  });

  test('the server refuses a file whose digest does not match', () async {
    final Uint8List file = Uint8List.fromList(List<int>.generate(10, (int i) => i));
    final FakeUploadServer server = FakeUploadServer();
    final ResumableUploader uploader = ResumableUploader(server, chunkSize: 4);
    final String id = await uploader.begin(file);
    server.stored[0] = Uint8List.fromList(<int>[9, 9, 9, 9]);
    await expectLater(uploader.run(file, id), throwsStateError);
    expect(server.completedDigest, isNull);
  });
}
