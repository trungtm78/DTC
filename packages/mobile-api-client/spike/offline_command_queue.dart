import 'dart:convert';

import 'package:machvon_api_client/machvon_api_client.dart';

/// Where a queued command stands. `unknown` is the honest state of a command whose request was sent and whose answer
/// never arrived: it may have been executed, so it is replayed with the same idempotency key and never re-created.
enum QueuedState { queued, unknown, accepted, rejected }

final class QueuedCommand {
  QueuedCommand({required this.operationId, required this.attemptKey, this.path, this.body, this.state = QueuedState.queued, this.errorCode});

  factory QueuedCommand.fromJson(Map<String, Object?> json) => QueuedCommand(
        operationId: json['operationId']! as String,
        attemptKey: json['attemptKey']! as String,
        path: (json['path'] as Map<String, Object?>?),
        body: json['body'],
        state: QueuedState.values.byName(json['state']! as String),
        errorCode: json['errorCode'] as String?,
      );

  final String operationId;

  /// The idempotency key of this intention; every replay of the command sends it.
  final String attemptKey;
  final Map<String, Object?>? path;
  final Object? body;
  QueuedState state;
  String? errorCode;

  Map<String, Object?> toJson() => <String, Object?>{
        'operationId': operationId,
        'attemptKey': attemptKey,
        'path': path,
        'body': body,
        'state': state.name,
        'errorCode': errorCode,
      };
}

/// The offline command queue of the mobile app (spike): commands are kept in order, sent when there is a network, and
/// replayed with their original key when an answer was lost. The state survives a process kill through [toJson].
class OfflineCommandQueue {
  OfflineCommandQueue(this._client, {List<QueuedCommand>? commands}) : commands = commands ?? <QueuedCommand>[];

  factory OfflineCommandQueue.fromJson(MachvonApiClient client, String json) => OfflineCommandQueue(
        client,
        commands: <QueuedCommand>[
          for (final Object? entry in jsonDecode(json) as List<Object?>) QueuedCommand.fromJson(entry! as Map<String, Object?>),
        ],
      );

  final MachvonApiClient _client;
  final List<QueuedCommand> commands;

  QueuedCommand enqueue(String operationId, {Map<String, Object?>? path, Object? body, String Function()? newKey}) {
    final QueuedCommand command = QueuedCommand(
      operationId: operationId,
      attemptKey: CommandAttempt.fresh(newKey).key,
      path: path,
      body: body,
    );
    commands.add(command);
    return command;
  }

  String toJson() => jsonEncode(<Object?>[for (final QueuedCommand command in commands) command.toJson()]);

  /// Sends the commands that are not decided yet, in order. A lost answer leaves the command `unknown` and stops the
  /// flush (the network is down, and later commands may depend on this one); a refusal of the server is final.
  Future<void> flush() async {
    for (final QueuedCommand command in commands) {
      if (command.state == QueuedState.accepted || command.state == QueuedState.rejected) continue;
      try {
        await _client.execute(command.operationId, path: command.path, body: command.body, attempt: CommandAttempt(command.attemptKey));
        command.state = QueuedState.accepted;
        command.errorCode = null;
      } on ApiError catch (error) {
        command.errorCode = error.code;
        if (error.status == 0 || error.status >= 500) {
          command.state = QueuedState.unknown;
          if (error.status == 0) return;
        } else {
          command.state = QueuedState.rejected;
        }
      }
    }
  }
}
