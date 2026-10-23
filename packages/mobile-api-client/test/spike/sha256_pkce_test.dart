import 'dart:convert';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';

import '../../spike/pkce.dart';
import '../../spike/sha256.dart';

void main() {
  group('sha256 (FIPS 180-4 test vectors, computed independently with Node)', () {
    test('empty input, one block, a padding boundary and a multi-block input', () {
      expect(sha256Hex(<int>[]), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(sha256Hex(ascii.encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      expect(
        sha256Hex(ascii.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
      );
      expect(sha256Hex(ascii.encode('a' * 1000)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
    });
  });

  group('PKCE with the system browser', () {
    final Uri authorize = Uri.parse('https://idp.example.test/realms/test/protocol/openid-connect/auth');
    final Uri redirect = Uri.parse('vn.machvon.app:/callback');

    test('derives the S256 challenge of RFC 7636 appendix B', () {
      expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    test('makes verifiers of 43 to 128 unreserved characters and refuses other lengths', () {
      final String verifier = newCodeVerifier(random: Random(1));
      expect(verifier.length, 64);
      expect(RegExp(r'^[A-Za-z0-9\-._~]+$').hasMatch(verifier), isTrue);
      expect(() => newCodeVerifier(length: 42), throwsRangeError);
      expect(() => newCodeVerifier(length: 129), throwsRangeError);
      expect(newCodeVerifier(length: 43).length, 43);
      expect(newCodeVerifier(length: 128).length, 128);
      expect(PkceSession.start().verifier, isNot(PkceSession.start().verifier));
    });

    test('builds an authorization-code request that carries the challenge and never the verifier', () {
      final PkceSession session = PkceSession.start(random: Random(2));
      final Uri url = session.authorizationUrl(authorizationEndpoint: authorize, clientId: 'machvon-mobile', redirectUri: redirect, scopes: <String>['openid', 'profile']);
      expect(url.queryParameters['response_type'], 'code');
      expect(url.queryParameters['code_challenge_method'], 'S256');
      expect(url.queryParameters['code_challenge'], codeChallengeS256(session.verifier));
      expect(url.queryParameters['scope'], 'openid profile');
      expect(url.queryParameters['state'], session.state);
      expect(url.toString(), isNot(contains(session.verifier)));
    });

    test('completes the login after the app was killed mid-redirect, from the stored session', () {
      final PkceSession started = PkceSession.start(random: Random(3));
      final String stored = jsonEncode(started.toJson());
      final PkceSession restored = PkceSession.fromJson(jsonDecode(stored) as Map<String, Object?>);
      final String? code = restored.codeFrom(Uri.parse('vn.machvon.app:/callback?code=abc123&state=${restored.state}'));
      expect(code, 'abc123');
      final Map<String, String> form = restored.tokenRequest(code: code!, clientId: 'machvon-mobile', redirectUri: redirect);
      expect(form['grant_type'], 'authorization_code');
      expect(form['code_verifier'], started.verifier);
      expect(form.containsKey('client_secret'), isFalse);
    });

    test('ignores a redirect that is not the answer to this session', () {
      final PkceSession session = PkceSession.start(random: Random(4));
      expect(session.codeFrom(Uri.parse('vn.machvon.app:/callback?code=abc&state=other')), isNull);
      expect(session.codeFrom(Uri.parse('vn.machvon.app:/callback?error=access_denied&state=${session.state}')), isNull);
      expect(session.codeFrom(Uri.parse('vn.machvon.app:/callback?state=${session.state}')), isNull);
      expect(session.codeFrom(Uri.parse('vn.machvon.app:/callback?code=&state=${session.state}')), isNull);
    });
  });
}
