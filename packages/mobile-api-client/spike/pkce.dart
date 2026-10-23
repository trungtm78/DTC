import 'dart:convert';
import 'dart:math';

import 'sha256.dart';

const int _minVerifierLength = 43;
const int _maxVerifierLength = 128;
const String _unreserved = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

String _base64UrlNoPadding(List<int> bytes) => base64Url.encode(bytes).replaceAll('=', '');

/// The one-time secret of a PKCE authorization (RFC 7636 section 4.1): 43 to 128 unreserved characters.
String newCodeVerifier({Random? random, int length = 64}) {
  if (length < _minVerifierLength || length > _maxVerifierLength) {
    throw RangeError.range(length, _minVerifierLength, _maxVerifierLength, 'length');
  }
  final Random source = random ?? Random.secure();
  return String.fromCharCodes(List<int>.generate(length, (int _) => _unreserved.codeUnitAt(source.nextInt(_unreserved.length))));
}

/// `S256` challenge of a verifier (RFC 7636 section 4.2): base64url of the SHA-256 digest, without padding.
String codeChallengeS256(String verifier) => _base64UrlNoPadding(sha256(ascii.encode(verifier)));

/// What the app keeps between the redirect to the system browser and the redirect back. If the app is killed in
/// between, [toJson] is what a retry restores, so the same verifier and state complete the login.
final class PkceSession {
  const PkceSession({required this.verifier, required this.state});

  factory PkceSession.start({Random? random}) {
    final Random source = random ?? Random.secure();
    return PkceSession(
      verifier: newCodeVerifier(random: source),
      state: _base64UrlNoPadding(List<int>.generate(24, (int _) => source.nextInt(256))),
    );
  }

  factory PkceSession.fromJson(Map<String, Object?> json) => PkceSession(verifier: json['verifier']! as String, state: json['state']! as String);

  final String verifier;
  final String state;

  Map<String, Object?> toJson() => <String, Object?>{'verifier': verifier, 'state': state};

  /// The URL for the system browser (not a web view): authorization code flow with PKCE.
  Uri authorizationUrl({required Uri authorizationEndpoint, required String clientId, required Uri redirectUri, required List<String> scopes}) =>
      authorizationEndpoint.replace(queryParameters: <String, String>{
        'response_type': 'code',
        'client_id': clientId,
        'redirect_uri': redirectUri.toString(),
        'scope': scopes.join(' '),
        'state': state,
        'code_challenge': codeChallengeS256(verifier),
        'code_challenge_method': 'S256',
      });

  /// The code in the redirect back, or null when the redirect is not an answer to this session (wrong state, an
  /// error, no code): the caller starts a new login instead of exchanging a code that is not theirs.
  String? codeFrom(Uri redirect) {
    final Map<String, String> query = redirect.queryParameters;
    if (query['state'] != state || query.containsKey('error')) return null;
    final String? code = query['code'];
    return code == null || code.isEmpty ? null : code;
  }

  /// The form body of the token request: the verifier proves that the app that asked is the app that exchanges.
  Map<String, String> tokenRequest({required String code, required String clientId, required Uri redirectUri}) => <String, String>{
        'grant_type': 'authorization_code',
        'code': code,
        'client_id': clientId,
        'redirect_uri': redirectUri.toString(),
        'code_verifier': verifier,
      };
}
