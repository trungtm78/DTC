import type { CommandInput, CommandOperation, ReadInput, ReadOperation } from '../src/index';

// These checks run in `npm run typecheck`; a wrong type fails compilation, so no suppression comments are needed.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];

type MoveInput = CommandInput<'moveOrganizationUnit'>;
type CreateInput = CommandInput<'createOrganizationUnit'>;

export type VersionedCommandRequiresTheVersion = Expect<Equal<'ifMatchVersion' extends RequiredKeys<MoveInput> ? true : false, true>>;
export type UnversionedCommandDoesNotTakeAVersion = Expect<Equal<'ifMatchVersion' extends RequiredKeys<CreateInput> ? true : false, false>>;
export type VersionedCommandRefusesAMissingVersion = Expect<
  Equal<{ path: { unitId: string }; body: { new_parent_id: string; effective_from: string; reason: string } } extends MoveInput ? true : false, false>
>;
export type PathParametersAreRequiredWhereTheRouteHasThem = Expect<Equal<'path' extends RequiredKeys<MoveInput> ? true : false, true>>;
export type BodyIsRequiredForCommandsThatTakeOne = Expect<Equal<'body' extends RequiredKeys<CreateInput> ? true : false, true>>;
export type ReadsAreGetsAndCommandsAreTheRest = Expect<
  Equal<['get_resources_organization_unit' extends ReadOperation ? true : false, 'grantRole' extends CommandOperation ? true : false], [true, true]>
>;
export type NoOperationIsBoth = Expect<Equal<ReadOperation & CommandOperation, never>>;
export type ListReadsNeedNoInput = Expect<Equal<object extends ReadInput<'get_resources_organization_unit'> ? true : false, true>>;
export type ReadByIdNeedsThePath = Expect<Equal<object extends ReadInput<'get_resources_organization_unit_id'> ? true : false, false>>;

export type RequiredQueryParametersAreRequired = Expect<Equal<object extends ReadInput<'searchGlobal'> ? true : false, false>>;
export type RequiredQueryParametersKeepTheirShape = Expect<Equal<ReadInput<'searchGlobal'>['query']['q'], string>>;
export type OptionalQueryParametersStayOptional = Expect<Equal<'query' extends RequiredKeys<ReadInput<'get_resources_organization_unit'>> ? true : false, false>>;
export type MultipartOperationsAreNotCommands = Expect<Equal<'uploadSystemTenantThemeAsset' extends CommandOperation ? true : false, false>>;
export type JsonCommandsRemainCommands = Expect<Equal<['createOrganizationUnit' extends CommandOperation ? true : false, 'grantRole' extends CommandOperation ? true : false], [true, true]>>;

describe('operation types', () => {
  it('are checked by the compiler (see the exported type aliases above)', () => {
    const checks: Array<VersionedCommandRequiresTheVersion | UnversionedCommandDoesNotTakeAVersion> = [true, true];
    expect(checks).toHaveLength(2);
  });
});
