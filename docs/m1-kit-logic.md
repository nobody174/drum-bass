# M1 kit logic report

Files: `src/kit/model.ts`, `src/kit/store.ts`, `src/kit/index.ts`, `src/storage/db.ts`, tests `src/kit/*.test.ts`.

## API
- Model (pure, immutable, `updatedAt = Date.now()` on every real change; no-ops return the same object):
  `PIECE_LIMITS`, `createDefaultPreset`, `pieceGroup`, `countGroup`, `canAdd`, `canRemove`, `addPiece`, `removePiece`,
  `movePiece(..., {snap})`, `resizePiece`, `setLocked`, `setMirrored`, `renamePreset`, `setNote`, `clearNote`,
  `matchNote`, `findConflicts`, `duplicatePreset`, `nextKitName` (next unused "Kit N"), `uniqueName` ("base", "base 2", ...). Extras: `STAGE_ASPECT` (16/9), `piecesOverlap`, `PIECE_ORDER`, `MIN_SIZE`, `MAX_SIZE`.
- Store: `KitBackend` interface, `createIdbBackend(dbName)`, `createKitStore(backend)`, singleton `kitStore`
  (`listPresets` sorted by name, `getPreset` -> null if missing, `savePreset`, `deletePreset` -> boolean,
  `getActiveId`, `setActiveId`, `ensureDefault`).
- `createIdbBackend(dbName, open?)` never caches a rejected open (Retry works) and drops the cached connection when `db.ts` reports `blocking` (it closes itself) or `terminated`.
- `src/storage/db.ts`: `openAppDb(dbName?, onClose?)`, DB version 1, upgrade creates any store from `STORES` that is missing ('kits' keyPath id, 'meta').

## Decisions
- Piece `size` is relative to stage HEIGHT; on the 16:9 stage the x half-extent is `size/2/STAGE_ASPECT`. Clamping and overlap use this.
- Locked: `movePiece`, `resizePiece`, `addPiece`, `removePiece` are no-ops (structure and layout are frozen). `setNote`/`clearNote` are allowed (MIDI learn is not layout editing). `setLocked` and rename work while locked. `setMirrored` is deliberately allowed while locked: it is a view switch for left-handed players, not layout editing (the UI labels it "Left-handed view").
- `resizePiece` re-clamps the position so a growing piece stays on stage. Mirror rounds to 1e-9 so mirror twice restores exactly.
- `addPiece` uses the default position (mirrored if the preset is mirrored), else the first free grid cell; pieces stay in canonical order, which makes `matchNote` deterministic (piece order, then zone insertion order).
- `setNote` rejects non-integer or out-of-range (0..127) notes. Conflicts are reported by `findConflicts`, not prevented.
- `deletePreset` returns false for the last preset or unknown id; deleting the active preset clears the meta and `getActiveId` falls back to the first preset by name. `ensureDefault` is serialized so concurrent calls create only one default.
- Adding stores in later milestones needs a `DB_VERSION` bump in `db.ts` (the upgrade handler is already create-if-missing).

## Unverified
- Nitro Max piece count (3 toms, 2 crashes, 1 ride) and all default notes (GM starter values, crash2 = 57, crash3 = 55, splash = 55, china = 52): verify with MIDI learn on the real kit.
- IndexedDB backend is not covered by automated tests (no fake-indexeddb); only the in-memory backend is. Needs a check in a real browser.

## Tests
`npx vitest run`: 65 passing overall (kit model + store incl. lock rule, unique names, open-retry and reopen-after-close). `npx tsc --noEmit` clean.
