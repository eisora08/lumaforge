## Session — Phase 2: Criteria Evaluator + ToolManager Integration

### Goal
Wire `criteria.detection` from extension manifests into the runtime so extensions auto-match to games without hardcoded ID branching.

### Part 1: Types and manifest parser
- `CriteriaDeclaration`, `DetectionCriteria`, `FilesPresenceCriteria` types in `src/extensions/types/index.ts`
- `criteria` field on `ExtensionManifestV1`
- `validateCriteria()` / `validateDetectionCriteria()` in manifest parser (`src/extensions/manifests/index.ts`)

### Part 2: Criteria evaluator engine
- `src/extensions/runtime/criteriaEvaluator.ts` — **new**
- `GameContext` type (installDir, appId, provider — all optional)
- `evaluateManifestCriteria(manifest, game)` → dispatches by `detection.type`
- `evaluateFilesPresence(criteria, game)` → checks all paths via `extensionFileExists` in install dir
- `filterMatchingManifests(manifests, game)` → batch filter
- Unknown criteria types → non-match with diagnostic reason

### Part 3: ToolManager integration
- `getApplicableTools(game)` → filters `_tools` by criteria via `evaluateManifestCriteria`
- `gameContextFromInstallDir(installDir)` → extracts Steam appId from path
- `detectToolsForGame()` → pre-filters by criteria before filesystem detection
- Tools without registered extensions always pass (backward compat)

### Part 4: Tests
- `src/__tests__/criteriaEvaluator.test.ts` — **new** — 10 tests: no-criteria passthrough, files_presence match/miss, missing installDir, fs error, unknown type, batch filter
- `src/__tests__/criteriaToolManagerIntegration.test.ts` — **new** — 6 tests: backward compat, criteria match/miss, unknown type, mixed batch, missing installDir
- Both use `vi.hoisted()` for shared mutable mock state (correct vitest 4.x pattern)

### Key Files Changed
- `src/extensions/types/index.ts` — CriteriaDeclaration, DetectionCriteria, FilesPresenceCriteria, criteria on ExtensionManifestV1
- `src/extensions/manifests/index.ts` — criteria validation in parser
- `src/extensions/runtime/criteriaEvaluator.ts` — **new** — evaluation engine
- `src/extensions/tools/ToolManager.ts` — getApplicableTools(), gameContextFromInstallDir(), updated detectToolsForGame()
- `src/__tests__/criteriaEvaluator.test.ts` — **new** — 10 unit tests
- `src/__tests__/criteriaToolManagerIntegration.test.ts` — **new** — 6 integration tests

### Build
- `tsc --noEmit` ✅ 0 new errors (23 pre-existing)
- `vitest run` ✅ 826 passed, 22 failed (all pre-existing)
- `vite build` ✅ (7.16s, only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)
