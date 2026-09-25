import { describe, it, expectTypeOf } from "vitest";
import * as queries from "@/lib/queries";
import type { TenantDb } from "@/lib/pg";
import type { Asset } from "@/lib/types";

/**
 * The Promise<T> contract, asserted at the TYPE level.
 *
 * WHY THIS FILE EXISTS. The whole safety argument for the Postgres port is
 * that turning ~44 sync functions async makes a missed `await` a COMPILE
 * error rather than a runtime surprise -- a Promise passed into JSX renders
 * nothing, and a Promise in a boolean test is always truthy, so neither fails
 * loudly. That argument holds only while every exported query really does
 * return a Promise. One `any`, one helper that forgets, and the guarantee is
 * gone while every test still passes.
 *
 * These assertions cost nothing at runtime: vitest's expectTypeOf is erased,
 * so the value of this file is entirely in `tsc` refusing to compile it.
 *
 * It ENUMERATES rather than lists. Adding a 45th query function needs no edit
 * here, and cannot escape the check by not being mentioned -- which is the
 * failure mode of a hand-written list.
 */

// Every exported name that is a function.
type FnKeys = {
  [K in keyof typeof queries]: (typeof queries)[K] extends (...args: never[]) => unknown
    ? K
    : never;
}[keyof typeof queries];

type ReturnsPromise<T> = T extends (...args: never[]) => infer R
  ? R extends Promise<unknown>
    ? true
    : false
  : never;

type TakesTenantDbFirst<T> = T extends (first: infer P, ...rest: never[]) => unknown
  ? [P] extends [TenantDb]
    ? true
    : false
  : never;

// The union of every function's verdict. If ANY of them is false, the union
// becomes true | false and the assertion below fails, naming nothing in
// particular but failing all the same -- which is enough to stop the merge.
type EveryReturnIsPromise = { [K in FnKeys]: ReturnsPromise<(typeof queries)[K]> }[FnKeys];
type EveryFirstArgIsTenantDb = {
  [K in FnKeys]: TakesTenantDbFirst<(typeof queries)[K]>;
}[FnKeys];

describe("the query layer's type contract", () => {
  it("every exported query function returns a Promise", () => {
    expectTypeOf<EveryReturnIsPromise>().toEqualTypeOf<true>();
  });

  it("every exported query function takes a TenantDb as its first argument", () => {
    // This is what stops a query reaching the database without a tenant in
    // scope: there is no other way to get a handle, and withTenant() is the
    // only thing that makes one.
    expectTypeOf<EveryFirstArgIsTenantDb>().toEqualTypeOf<true>();
  });

  it("there is at least one function, so the checks above are not vacuous", () => {
    // Without this, a change that made FnKeys resolve to `never` would turn
    // both assertions into assertions about nothing -- and they would pass.
    expectTypeOf<FnKeys>().not.toEqualTypeOf<never>();
  });

  it("the enumeration is checked by tsc, not at runtime", () => {
    // The await assertions live in typeOnlyChecks() below, which is compiled
    // but never called. An earlier version put them in an `it` body and vitest
    // actually EXECUTED queries.getAssets(db) against a null handle -- the
    // type assertions were right and the test still failed, for a reason that
    // had nothing to do with the contract.
    expectTypeOf<EveryReturnIsPromise>().toEqualTypeOf<true>();
  });
});

/**
 * COMPILED BUT NEVER CALLED. Everything here is checked by `tsc` and executes
 * nowhere, which is the only safe way to assert on the shape of a call whose
 * arguments do not exist at test time.
 *
 * Each @ts-expect-error is self-verifying: if the line it guards ever STOPS
 * being an error, @ts-expect-error itself becomes the error and the build
 * fails. These assertions cannot rot into no-ops.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function typeOnlyChecks(db: TenantDb): Promise<void> {
  // @ts-expect-error a missed await: Promise<Asset[]> is not Asset[]
  const assets: Asset[] = queries.getAssets(db);
  void assets;

  // @ts-expect-error .filter does not exist on Promise<Asset[]>
  void queries.getAssets(db).filter((a: Asset) => a.id);

  // @ts-expect-error a Promise is not the awaited object either
  const one: Asset | undefined = queries.getAsset(db, "AST-01");
  void one;

  // The awaited forms DO check, so the errors above are about the missing
  // await and nothing else.
  const okAssets: Asset[] = await queries.getAssets(db);
  const okOne: Asset | undefined = await queries.getAsset(db, "AST-01");
  void okAssets;
  void okOne;
}
