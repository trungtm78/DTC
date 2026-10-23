import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:machvon_api_client/machvon_api_client.dart';

import '../../spike/offline_command_queue.dart';

/// A server that executes each idempotency key once and replays the stored answer for a repeat. It can lose the answer
/// after executing: the request arrived, the response never reached the client.
final class IdempotentServer implements HttpTransport {
  final Map<String, HttpResult> _answers = <String, HttpResult>{};
  final List<Object?> records = <Object?>[];
  final List<String> keysSeen = <String>[];
  int dropAnswers = 0;
  int refuseWith = 0;

  @override
  Future<HttpResult> send(HttpCall call) async {
    final String key = call.headers['idempotency-key']!;
    keysSeen.add(key);
    if (refuseWith != 0) {
      return HttpResult(
        status: refuseWith,
        headers: const <String, String>{'content-type': 'application/problem+json'},
        body: jsonEncode(<String, Object?>{'type': 'urn:x', 'title': 't', 'status': refuseWith, 'code': refuseWith >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED'}),
      );
    }
    final HttpResult? stored = _answers[key];
    final HttpResult answer = stored ??
        () {
          records.add(jsonDecode(call.body!));
          return HttpResult(status: 201, headers: const <String, String>{'content-type': 'application/json'}, body: jsonEncode(<String, Object?>{'id': 'record-${records.length}'}));
        }();
    _answers[key] = answer;
    if (dropAnswers > 0) {
      dropAnswers -= 1;
      throw StateError('connection lost after the request was sent');
    }
    return answer;
  }
}

MachvonApiClient clientFor(IdempotentServer server) => MachvonApiClient(
      baseUrl: Uri.parse('https://api.example.test/v1/'),
      transport: server,
      token: () async => 'token',
      delay: (Duration wait) async {},
    );

const String operation = 'createOrganizationUnit';

void main() {
  test('a command whose answer was lost ends UNKNOWN, then ACCEPTED, with one record on the server and no new key (AC-ST-KERNEL-001-2)', () async {
    final IdempotentServer server = IdempotentServer()..dropAnswers = 1;
    final OfflineCommandQueue queue = OfflineCommandQueue(clientFor(server));
    final QueuedCommand command = queue.enqueue(operation, body: <String, Object?>{'code': 'R-1'});
    expect(command.state, QueuedState.queued);

    await queue.flush();
    expect(command.state, QueuedState.unknown);
    expect(command.errorCode, networkErrorCode);
    expect(server.records, hasLength(1));

    await queue.flush();
    expect(command.state, QueuedState.accepted);
    expect(server.records, hasLength(1));
    expect(server.keysSeen, <String>[command.attemptKey, command.attemptKey]);
  });

  test('survives a process kill: the stored queue replays the command with the original key', () async {
    final IdempotentServer server = IdempotentServer()..dropAnswers = 1;
    final OfflineCommandQueue before = OfflineCommandQueue(clientFor(server));
    final QueuedCommand command = before.enqueue(operation, body: <String, Object?>{'code': 'R-2'});
    await before.flush();
    final String stored = before.toJson();

    final OfflineCommandQueue after = OfflineCommandQueue.fromJson(clientFor(server), stored);
    expect(after.commands.single.state, QueuedState.unknown);
    await after.flush();
    expect(after.commands.single.state, QueuedState.accepted);
    expect(server.records, hasLength(1));
    expect(server.keysSeen.toSet(), <String>{command.attemptKey});
  });

  test('keeps the order: a command behind an unknown one waits for the network', () async {
    final IdempotentServer server = IdempotentServer()..dropAnswers = 1;
    final OfflineCommandQueue queue = OfflineCommandQueue(clientFor(server));
    final QueuedCommand first = queue.enqueue(operation, body: <String, Object?>{'code': 'A'});
    final QueuedCommand second = queue.enqueue(operation, body: <String, Object?>{'code': 'B'});
    await queue.flush();
    expect(<QueuedState>[first.state, second.state], <QueuedState>[QueuedState.unknown, QueuedState.queued]);
    expect(server.records, hasLength(1));
    await queue.flush();
    expect(<QueuedState>[first.state, second.state], <QueuedState>[QueuedState.accepted, QueuedState.accepted]);
    expect(server.records, <Object?>[
      <String, Object?>{'code': 'A'},
      <String, Object?>{'code': 'B'},
    ]);
  });

  test('a refusal of the server is final and does not stop the commands behind it', () async {
    final IdempotentServer server = IdempotentServer()..refuseWith = 422;
    final OfflineCommandQueue queue = OfflineCommandQueue(clientFor(server));
    final QueuedCommand refused = queue.enqueue(operation, body: <String, Object?>{'code': 'bad'});
    await queue.flush();
    expect(refused.state, QueuedState.rejected);
    expect(refused.errorCode, 'VALIDATION_FAILED');
    server.refuseWith = 0;
    final QueuedCommand next = queue.enqueue(operation, body: <String, Object?>{'code': 'good'});
    await queue.flush();
    expect(refused.state, QueuedState.rejected);
    expect(next.state, QueuedState.accepted);
    expect(server.records, hasLength(1));
  });

  test('a server error leaves the command UNKNOWN (it may have run) and the flush goes on', () async {
    final IdempotentServer server = IdempotentServer()..refuseWith = 503;
    final OfflineCommandQueue queue = OfflineCommandQueue(clientFor(server));
    final QueuedCommand command = queue.enqueue(operation, body: <String, Object?>{'code': 'x'});
    await queue.flush();
    expect(command.state, QueuedState.unknown);
    expect(command.errorCode, 'INTERNAL_ERROR');
    server.refuseWith = 0;
    await queue.flush();
    expect(command.state, QueuedState.accepted);
    expect(command.errorCode, isNull);
  });

  test('uses a supplied key generator for the attempt key', () {
    final OfflineCommandQueue queue = OfflineCommandQueue(clientFor(IdempotentServer()));
    expect(queue.enqueue(operation, newKey: () => 'fixed-key-0123456789').attemptKey, 'fixed-key-0123456789');
  });
}
