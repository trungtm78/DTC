import 'dart:math';

/// A random version 4 UUID: 36 visible characters, inside the server rule of 16 to 128 for idempotency keys.
String newUuidV4([Random? random]) {
  final Random source = random ?? Random.secure();
  final List<int> bytes = List<int>.generate(16, (int _) => source.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final String hex = bytes.map((int byte) => byte.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// One user intention to change something. Every request that belongs to the same intention (a retry after a lost
/// answer, a second tap on the same button, a replay of the offline queue) must reuse the attempt so the server
/// executes it once; a new intention starts a new attempt.
final class CommandAttempt {
  const CommandAttempt(this.key);

  /// A new attempt with a fresh key.
  factory CommandAttempt.fresh([String Function()? generate]) => CommandAttempt((generate ?? newUuidV4)());

  final String key;
}
