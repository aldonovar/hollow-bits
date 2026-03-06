# BLOCK 3 - Comping + Punch Editing (Execution Spec)

## 1. Scope
- Deliver pro take editing for audio tracks with non-destructive comping.
- Keep timeline UX fast under heavy edit loops.
- Preserve project compatibility while features are under active hardening.

## 2. Functional goals
- Punch In/Out with pre-roll and count-in ready in transport flow.
- Non-destructive comp lane built from `CompSegment[]`.
- Editing parity for take material: split, trim, consolidate, reverse.
- Strong metadata consistency between clip edits and `RecordingTake`.

## 3. Data model
- `Track.punchRange` controls punch behavior:
  - `enabled`, `inBar`, `outBar`, `preRollBars`, `countInBars`.
- `Track.recordingTakes[]` is source-of-truth for recorded takes.
- `Track.takeLanes[]` stores recording lanes and comp lane (`isCompLane: true`).
- `TakeLane.compSegments[]` represents final comp decision graph.
- Comp audio in arrangement is rendered as derived clips with id prefix `comp-seg-`.

## 4. Runtime architecture
### 4.1 Punch record plan
- `resolvePunchRecordingPlan()` merges active armed-audio punch ranges.
- Playback starts at `punchIn - preRoll - countIn`.
- Recording commit trims lead-in by `sourceTrimOffsetBars`.
- Auto stop finalizes when transport reaches computed punch out.

### 4.2 Recording finalize path
- `buildRecordingTakeCommit()` applies:
  - latency compensation
  - pre-roll/count-in trim
  - minimum length safety clamp
- `commitRecordingTakeBatch()` commits lane+take+clip atomically per track.

### 4.3 Comp rendering
- `promoteTakeToComp()` creates segment(s) pointing to source take bars.
- `rebuildCompDerivedClips()` materializes `[COMP]` clips from segments.
- Derived clips stay non-destructive; source recorded takes remain untouched.

### 4.4 Edit synchronization
- Normal clip edits:
  - `syncTakeMetadataForClip()` updates matching take and clamps comp segments.
- Split:
  - `splitTakeForClip()` clones take metadata into left/right takes and splits overlapping comp segments.
- Comp clip edits:
  - `applyCompClipEdits()` rewrites segment timing/offset/fades then rebuilds derived comp clips.

## 5. UX touchpoints shipped in this block
- Timeline context action: `Enviar a Comp Lane`.
- Track header punch toggle (`P`).
- Hotkeys:
  - `Alt+P`: toggle punch on selected track
  - `Alt+I`: set punch in at transport cursor
  - `Alt+O`: set punch out at transport cursor

## 6. Reliability guards
- Punch range normalization keeps valid in/out ordering and non-negative pre-roll/count-in.
- Segment merge pass removes contiguous fragmentation and limits drift in segment graph.
- Comp edits are clamped to source take bounds.
- Recording finalization keeps minimum bar length to avoid zero-size artifacts.

## 7. QA matrix for Block 3
- Unit:
  - punch plan merge behavior
  - take metadata sync after clip edit
  - take split + comp segment split
  - promote take to comp lane
  - comp segment rewrite via comp clip edits
  - trim offset commit for punch lead-in
- Stress:
  - 1000 record finalize cycles without take loss
  - long session edit loops with repeated split/trim/comp updates
- Build gates:
  - `npm run typecheck`
  - `npm run test:unit`
  - `npm run build`

## 8. Remaining Block 3 backlog (next slices)
- Visual comp lane overlay in timeline (segment boundaries + active lane state).
- Direct crossfade handles for comp segments in UI.
- Dedicated punch panel in transport with numeric in/out/pre-roll/count-in controls.
- Per-take audition/solo/mute workflow in lane UI.
- Undo grouping for comp edit bursts (single logical user action).
- Regression tests for punch auto-stop with mixed track punch ranges.

## 9. Release readiness for Block 3 completion
- All QA matrix gates green.
- No critical data-loss bug in record/split/comp/edit workflow.
- 90 min continuous live edit session without crash or desync.
- Feature flag option remains available until Block 4 hardening starts.
