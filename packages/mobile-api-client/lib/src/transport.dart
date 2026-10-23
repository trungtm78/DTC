/// One HTTP request the client wants sent.
final class HttpCall {
  const HttpCall({required this.method, required this.url, required this.headers, this.body});

  final String method;
  final Uri url;

  /// Header names are lower case.
  final Map<String, String> headers;
  final String? body;
}

/// What came back; header names are lower case.
final class HttpResult {
  const HttpResult({required this.status, required this.headers, required this.body});

  final int status;
  final Map<String, String> headers;
  final String body;

  bool get ok => status >= 200 && status < 300;
}

/// The one thing the client needs from the platform. A real adapter (`dart:io`, a package, a platform channel) only has
/// to send the call and report what arrived; it throws when no answer arrives at all, which the client reports as
/// `NETWORK_ERROR`. Tests plug in a fake.
abstract interface class HttpTransport {
  Future<HttpResult> send(HttpCall call);
}
