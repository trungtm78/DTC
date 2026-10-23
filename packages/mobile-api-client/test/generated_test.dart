import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:machvon_api_client/machvon_api_client.dart';

final class _Recorder implements HttpTransport {
  final List<HttpCall> calls = <HttpCall>[];

  @override
  Future<HttpResult> send(HttpCall call) async {
    calls.add(call);
    return const HttpResult(status: 200, headers: <String, String>{'content-type': 'application/json'}, body: '{"operation_id":"x","status":"CREATED","resource_version":1}');
  }
}

MachvonApiClient _client(_Recorder transport) => MachvonApiClient(
      baseUrl: Uri.parse('https://api.example.test'),
      transport: transport,
      token: () async => 'token',
      newKey: () => 'generated-key-0123456789',
      newCorrelationId: () => 'corr',
    );

void main() {
  test('the operation table has one descriptor per operation and knows the header protocol of each', () {
    expect(operationDescriptors.length, greaterThan(800));
    final OperationDescriptor move = operationDescriptors['moveOrganizationUnit']!;
    expect(move.method, 'POST');
    expect(move.path, '/org-units/{unitId}/move');
    expect(move.versioned, isTrue);
    expect(move.isRead, isFalse);
    final OperationDescriptor grant = operationDescriptors['grantRole']!;
    expect(grant.stepUp, 'aal2');
    expect(operationDescriptors['get_resources_organization_unit']!.isRead, isTrue);
  });

  test('a typed request keeps the wire names and leaves out optional members that are null', () {
    const OrgUnitCreate body = OrgUnitCreate(code: 'ABC', name: 'Unit', parentId: 'p', unitType: 'DEPARTMENT', validFrom: '2026-01-01');
    expect(body.toJson(), <String, Object?>{'code': 'ABC', 'name': 'Unit', 'parent_id': 'p', 'unit_type': 'DEPARTMENT', 'valid_from': '2026-01-01'});
    const OrgUnitCreate full = OrgUnitCreate(code: 'ABC', name: 'Unit', parentId: 'p', unitType: 'DEPARTMENT', validFrom: '2026-01-01', isInvestor: true, administrativeCode: '123');
    expect(full.toJson()['is_investor'], isTrue);
    expect(full.toJson()['administrative_code'], '123');
  });

  test('a typed request with a list encodes as JSON', () {
    const RoleGrantCreate body = RoleGrantCreate(membershipId: 'm', roleId: 'r', scopeKind: 'PROJECT', reason: 'because of the project', scopeRefIds: <String>['a', 'b']);
    expect(jsonDecode(jsonEncode(body)), <String, Object?>{
      'membership_id': 'm',
      'role_id': 'r',
      'scope_kind': 'PROJECT',
      'scope_ref_ids': <Object?>['a', 'b'],
      'reason': 'because of the project',
    });
  });

  test('a typed command sends the body, the idempotency key and, when versioned, If-Match', () async {
    final _Recorder transport = _Recorder();
    final MachvonApiClient client = _client(transport);

    await client.createOrganizationUnit(const OrgUnitCreate(code: 'ABC', name: 'Unit', parentId: 'p', unitType: 'DEPARTMENT', validFrom: '2026-01-01'));
    await client.moveOrganizationUnit(const OrgUnitMove(newParentId: 'q', effectiveFrom: '2026-02-01', reason: 'reorganisation of the board'), unitId: 'u-1', ifMatchVersion: 3);

    final HttpCall create = transport.calls[0];
    expect(create.method, 'POST');
    expect(create.url.path, '/org-units');
    expect(create.headers['idempotency-key'], 'generated-key-0123456789');
    expect(jsonDecode(create.body!), containsPair('parent_id', 'p'));

    final HttpCall move = transport.calls[1];
    expect(move.url.path, '/org-units/u-1/move');
    expect(move.headers['if-match'], '"3"');
    expect(jsonDecode(move.body!), containsPair('new_parent_id', 'q'));
  });

  test('a typed command can be retried with the attempt of the first try', () async {
    final _Recorder transport = _Recorder();
    final MachvonApiClient client = _client(transport);
    const CommandAttempt attempt = CommandAttempt('the-same-attempt-key');
    const OrgUnitCreate body = OrgUnitCreate(code: 'ABC', name: 'Unit', parentId: 'p', unitType: 'DEPARTMENT', validFrom: '2026-01-01');
    await client.createOrganizationUnit(body, attempt: attempt);
    await client.createOrganizationUnit(body, attempt: attempt);
    expect(transport.calls.map((HttpCall call) => call.headers['idempotency-key']).toSet(), <String?>{'the-same-attempt-key'});
  });

  test('a typed read takes path parameters and a query, and sends no idempotency key', () async {
    final _Recorder transport = _Recorder();
    await _client(transport).getResourcesOrganizationUnit(query: <String, Object?>{'limit': 5});
    final HttpCall call = transport.calls.single;
    expect(call.method, 'GET');
    expect(call.url.toString(), 'https://api.example.test/resources/organization_unit?limit=5');
    expect(call.headers.containsKey('idempotency-key'), isFalse);
  });
}
