import 'dart:convert';

import 'api_error.dart';
import 'command_attempt.dart';
import 'operation_descriptor.dart';
import 'operations.generated.dart';
import 'transport.dart';

const String _inProgressCode = 'IDEMPOTENCY_IN_PROGRESS';
const int _defaultRetryAfterSeconds = 2;
const int _maxRetryAfterSeconds = 10;
const int _maxInProgressRetries = 5;
const int _maxPages = 1000;

/// Returns the bearer token of the session; called for every request, so an expired or refreshed token is never reused.
typedef TokenProvider = Future<String?> Function();

/// Waits for the given duration; injectable so tests do not wait.
typedef Delay = Future<void> Function(Duration duration);

/// The MACHVON API client of the mobile application.
///
/// Reads are plain GETs. Commands always send an `Idempotency-Key` (one per [CommandAttempt]) and, for versioned
/// operations, `If-Match` with the version the caller saw; an answer of `IDEMPOTENCY_IN_PROGRESS` is retried with the
/// same key, every other failure is thrown as an [ApiError]. The typed methods of the contract are generated as the
/// extension `MachvonOperations`; [execute] is what they call.
class MachvonApiClient {
  MachvonApiClient({
    required this.baseUrl,
    required this.transport,
    required this.token,
    this.locale,
    String Function()? newKey,
    String Function()? newCorrelationId,
    Delay? delay,
  })  : _newKey = newKey ?? newUuidV4,
        _newCorrelationId = newCorrelationId ?? newUuidV4,
        _delay = delay ?? Future<void>.delayed;

  final Uri baseUrl;
  final HttpTransport transport;
  final TokenProvider token;
  final String Function()? locale;
  final String Function() _newKey;
  final String Function() _newCorrelationId;
  final Delay _delay;

  /// Calls one operation of the contract by its operationId.
  ///
  /// [body] is a `RequestModel` or any JSON-encodable value. Throws [ArgumentError] for an unknown operation or a
  /// missing path parameter before anything is sent, and [ApiError] for every failed call.
  Future<Object?> execute(
    String operationId, {
    Map<String, Object?>? path,
    Map<String, Object?>? query,
    Object? body,
    int? ifMatchVersion,
    CommandAttempt? attempt,
  }) async {
    final OperationDescriptor? descriptor = operationDescriptors[operationId];
    if (descriptor == null) throw ArgumentError.value(operationId, 'operationId', 'is not an operation of the contract');
    final Uri url = _urlFor(descriptor, path, query);
    final String correlationId = _newCorrelationId();
    final String? idempotencyKey = descriptor.isRead ? null : (attempt ?? CommandAttempt.fresh(_newKey)).key;
    final String? encoded = body == null ? null : jsonEncode(body);

    for (int retries = 0;; retries += 1) {
      // A failing token provider is not a network failure: its error reaches the caller untouched.
      final Map<String, String> headers = await _headersFor(correlationId, idempotencyKey, ifMatchVersion, encoded != null);
      final HttpResult result;
      try {
        result = await transport.send(HttpCall(method: descriptor.method, url: url, headers: headers, body: encoded));
      } on Object {
        throw ApiError.network(correlationId);
      }
      if (result.ok) return _answerOf(result, correlationId);
      final ApiError error = ApiError.fromResponse(
        status: result.status,
        headers: result.headers,
        body: result.body,
        fallbackCorrelationId: correlationId,
      );
      if (idempotencyKey != null && error.code == _inProgressCode && retries < _maxInProgressRetries) {
        final int seconds = (error.retryAfterSeconds ?? _defaultRetryAfterSeconds).clamp(0, _maxRetryAfterSeconds);
        await _delay(Duration(seconds: seconds));
        continue;
      }
      throw error;
    }
  }

  /// Reads every page of a list operation, following `next_cursor`, and returns the items in order.
  Future<List<Object?>> readAll(String operationId, {Map<String, Object?>? path, Map<String, Object?>? query}) async {
    final List<Object?> items = <Object?>[];
    final Set<String> seen = <String>{};
    String? cursor;
    for (int page = 0; page < _maxPages; page += 1) {
      final Map<String, Object?> pageQuery = <String, Object?>{...?query, if (cursor != null) 'cursor': cursor};
      final Object? answer = await execute(operationId, path: path, query: pageQuery);
      if (answer is! Map<String, Object?>) throw ApiError.unusableAnswer(200, 'pagination-answer');
      final Object? pageItems = answer['items'];
      if (pageItems is List<Object?>) items.addAll(pageItems);
      final Object? next = answer['next_cursor'];
      if (next is! String) return items;
      if (!seen.add(next)) throw ApiError.unusableAnswer(200, 'pagination-cursor-repeated');
      cursor = next;
    }
    throw ApiError.unusableAnswer(200, 'pagination-limit');
  }

  Uri _urlFor(OperationDescriptor descriptor, Map<String, Object?>? path, Map<String, Object?>? query) {
    final String basePath = baseUrl.path.replaceAll(RegExp(r'/+$'), '');
    final String filled = descriptor.path.replaceAllMapped(RegExp(r'\{([^{}/]+)\}'), (Match match) {
      final Object? value = path?[match.group(1)!];
      if (value == null) throw ArgumentError.value(match.group(1), 'path', 'is a path parameter without a value');
      return Uri.encodeComponent(value.toString());
    });
    final String search = <String>[
      for (final MapEntry<String, Object?> entry in (query ?? const <String, Object?>{}).entries)
        if (entry.value != null)
          for (final Object? item in entry.value is List<Object?> ? entry.value! as List<Object?> : <Object?>[entry.value])
            '${Uri.encodeQueryComponent(entry.key).replaceAll('+', '%20')}=${Uri.encodeQueryComponent(item.toString()).replaceAll('+', '%20')}',
    ].join('&');
    return baseUrl.replace(path: '$basePath$filled', query: search.isEmpty ? null : search);
  }

  Future<Map<String, String>> _headersFor(String correlationId, String? idempotencyKey, int? ifMatchVersion, bool hasBody) async {
    final String? bearer = await token();
    final String? language = locale?.call();
    return <String, String>{
      'accept': 'application/json, application/problem+json',
      'x-correlation-id': correlationId,
      if (bearer != null) 'authorization': 'Bearer $bearer',
      if (language != null) 'accept-language': language,
      if (idempotencyKey != null) 'idempotency-key': idempotencyKey,
      if (ifMatchVersion != null) 'if-match': '"$ifMatchVersion"',
      if (hasBody) 'content-type': 'application/json',
    };
  }

  Object? _answerOf(HttpResult result, String correlationId) {
    if (result.status == 204) return null;
    try {
      return jsonDecode(result.body);
    } on FormatException {
      throw ApiError.unusableAnswer(result.status, correlationId);
    }
  }
}
