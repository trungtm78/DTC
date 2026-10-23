import 'dart:typed_data';

import 'sha256.dart';

/// The server side of a chunked upload, as the spike needs it. `received` is the truth after a network loss: the
/// client asks instead of guessing which chunks arrived.
abstract interface class ChunkUploadServer {
  Future<String> begin({required int totalBytes, required int chunkSize});
  Future<Set<int>> received(String uploadId);
  Future<void> putChunk(String uploadId, int index, Uint8List bytes);

  /// Joins the chunks and compares their SHA-256 with [sha256Hex]; throws when they differ.
  Future<void> complete(String uploadId, String sha256Hex);
}

/// Uploads a file in chunks and resumes an interrupted upload without sending a chunk twice. The digest of the whole
/// file is computed here and the server checks it again on `complete`.
final class ResumableUploader {
  ResumableUploader(this._server, {this.chunkSize = 1024 * 1024});

  final ChunkUploadServer _server;
  final int chunkSize;

  /// Opens an upload and returns its id, which the app keeps so that [run] can continue after the process dies.
  Future<String> begin(Uint8List source) => _server.begin(totalBytes: source.length, chunkSize: chunkSize);

  /// Sends the chunks the server does not hold and completes the upload. A failed `putChunk` propagates; calling
  /// [run] again with the same id continues where the server stopped.
  Future<void> run(Uint8List source, String uploadId) async {
    final Set<int> already = await _server.received(uploadId);
    final int chunks = (source.length + chunkSize - 1) ~/ chunkSize;
    for (int index = 0; index < chunks; index += 1) {
      if (already.contains(index)) continue;
      final int end = (index + 1) * chunkSize > source.length ? source.length : (index + 1) * chunkSize;
      await _server.putChunk(uploadId, index, Uint8List.sublistView(source, index * chunkSize, end));
    }
    await _server.complete(uploadId, sha256Hex(source));
  }
}
