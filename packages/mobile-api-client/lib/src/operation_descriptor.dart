/// How to call one operation of the contract: the generated table `operationDescriptors` holds one per operationId.
final class OperationDescriptor {
  const OperationDescriptor({
    required this.method,
    required this.path,
    required this.versioned,
    required this.stepUp,
    required this.permission,
  });

  /// Upper-case HTTP method.
  final String method;

  /// Route template with `{name}` path parameters.
  final String path;

  /// The caller must send the version it saw (`If-Match`).
  final bool versioned;

  /// Required assurance level (`aal2`), or null.
  final String? stepUp;

  final String permission;

  /// Reads are plain GETs; every other method is a command with an `Idempotency-Key`.
  bool get isRead => method == 'GET';
}
