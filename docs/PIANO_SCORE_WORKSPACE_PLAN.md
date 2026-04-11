# Piano Score Workspace Plan

## Goal

Add a new left-sidebar workspace to HOLLOW BITS that combines:

- A refined piano-oriented score viewer
- A cinematic piano playback surface inspired by Synthesia
- MIDI-to-score conversion
- Audio/stem-to-piano-score assisted transcription
- Tight transport sync with the DAW

This feature must feel native to the current DAW shell, not like an embedded tool.

## Product Scope

### In scope for v1

- New sidebar tool entry for score workspace
- Score view for existing MIDI clips
- Bottom piano visualization with aesthetic playback focus
- Shared playhead and seek sync with DAW transport
- Piano-specialized transcription from audio clips or stems
- Manual correction tools for score cleanup
- Internal score document model

### Out of scope for v1

- Fully automatic, production-perfect transcription of dense full mixes
- Orchestral notation
- Guitar tablature, drum notation, lead sheets
- Advanced engraving features for print publishing
- Multi-instrument conductor score workflow

## Existing Repo Foundations

The project already has strong base pieces:

- Audio-to-note transcription in `services/noteScannerService.ts`
- Physical refinement worker in `workers/note-transcriber.worker.ts`
- Existing scanner UI in `components/NoteScannerPanel.tsx`
- Existing piano-style playback UI in `components/SynthesiaVisualizer.tsx`
- Central transport authority in `services/audioEngine.ts` and `services/engineAdapter.ts`
- Left sidebar + `FluidPanel` overlay pattern in `App.tsx`

The major missing layer is a score-native musical model and notation renderer.

## Core Product Decision

The feature should not render notation directly from raw `Note[]`.

Instead, we should introduce a canonical `ScoreDocument` layer:

- DAW clip data remains optimized for editing and playback
- `ScoreDocument` remains optimized for notation, hands, voices, rests, pedal, and readability
- Both layers stay linked through source mapping

This is the key architectural boundary that keeps the feature robust.

## UX Placement

### Sidebar entry

Add a new left sidebar item near the current note scanner entry in `App.tsx`.

Suggested product label:

- `Piano Score`

Suggested behavior:

- Opens as a full-height `FluidPanel` overlay from `left-[50px]`
- Keeps the same immersive shell treatment already used by the scanner
- Lazy-loaded like the current AI and scanner panels

### Workspace layout

The new workspace should use a three-zone layout:

1. Top command bar
- Source selector
- Mode switch: `Score`, `Transcribe`, `Correct`, `Compare`
- Follow transport
- Quantization display
- Confidence display
- Hand split mode
- Export actions

2. Main score stage
- Grand staff score viewer
- Resizable inspector rail
- Measure ruler
- Playhead overlay
- Selection and correction overlays

3. Bottom piano cinema
- Premium Synthesia-like lane
- DAW-synced playhead
- Key lighting and note trails
- Pedal glow and resonance cues
- Optional compact overview timeline

Recommended vertical split:

- Score stage: 62% to 70%
- Piano cinema: 30% to 38%

The split should be draggable and persisted.

## Visual Direction

The UI should feel closer to a premium performance console than a utility panel.

### Score stage

- Deep graphite base with subtle warm paper-toned notation layer
- Thin luminous measure guides
- High-contrast noteheads and stems
- Minimal chrome around the notation
- Cinematic playhead sweep, not a harsh editor cursor

### Bottom piano cinema

- Avoid toy-like Synthesia colors
- Use restrained note color families based on hand, confidence, and dynamics
- White keys should look physical and premium
- Black keys should have depth, not flat rectangles
- Motion should prioritize elegance over brightness

### Shared motion language

- Smooth cubic-bezier transitions like existing `FluidPanel`
- Soft halo highlights matching the DAW violet/rose palette
- Reduced-motion safe fallbacks

## Functional Modes

### 1. Score Mode

- View score for a selected MIDI clip or score source
- Follow transport and seek from score clicks
- Highlight notes under playback

### 2. Transcribe Mode

- Choose source audio clip or stem
- Run piano-specialized analysis
- Preview raw result versus cleaned result
- Show confidence by region

### 3. Correct Mode

- Reassign left/right hand
- Merge or split chords
- Adjust spelling
- Force ties or rests
- Mark pedal regions
- Simplify notation density

### 4. Compare Mode

- Top layer: score
- Bottom layer: piano cinema
- Optional original waveform or source reference strip

## Architecture

### New domain model

Add new score-focused types, separate from the current clip note model:

- `ScoreDocument`
- `ScorePart`
- `ScoreStaff`
- `ScoreMeasure`
- `ScoreVoice`
- `ScoreEvent`
- `ScoreNoteEvent`
- `ScoreRestEvent`
- `ScorePedalEvent`
- `ScoreSourceMap`
- `ScoreLayoutState`
- `ScoreRenderSnapshot`

### Source mapping

Every score event should be traceable back to:

- `trackId`
- `clipId`
- original note index or transcription group
- confidence
- transform history

This is essential for correction workflows.

### New services

Planned services:

- `services/scoreDocumentService.ts`
- `services/pianoScoreConversionService.ts`
- `services/pianoTranscriptionService.ts`
- `services/scoreLayoutService.ts`
- `services/scoreTransportSyncService.ts`
- `services/scoreEditingService.ts`

### New UI modules

Planned components:

- `components/PianoScoreWorkspace.tsx`
- `components/ScoreToolbar.tsx`
- `components/ScoreViewport.tsx`
- `components/GrandStaffCanvas.tsx`
- `components/ScoreInspector.tsx`
- `components/PianoCinema.tsx`
- `components/TranscriptionRegionStrip.tsx`

## Data Pipeline

### A. MIDI clip to score

Pipeline:

1. Read `Clip.notes`
2. Normalize time and dynamics
3. Detect measure boundaries
4. Infer left/right hand
5. Infer voices inside each hand
6. Build rests and ties
7. Apply notation quantization
8. Build `ScoreDocument`
9. Render score + piano cinema

This path should be considered the gold-standard v1 workflow.

### B. Audio clip to piano score

Pipeline:

1. Reuse existing scanner output
2. Add piano-specialized cleanup
3. Group notes into chord buckets
4. Infer hand split
5. Infer sustain/pedal-like regions
6. Generate notation-friendly durations
7. Mark low-confidence areas
8. Build editable `ScoreDocument`

This path must be explicitly assistive, not marketed as perfect automation.

## Piano-Specialized Heuristics

The piano focus is the differentiator.

### Hand split heuristics

Use weighted logic:

- Pitch register
- Chord center of gravity
- Temporal continuity
- Voice-leading continuity
- Overlap and reach constraints

### Voice inference

We need separate handling for:

- Single melodic line
- Chordal accompaniment
- Alberti/arpeggio patterns
- Sustained bass with moving upper voices

### Notation quantization

Playback quantization and notation quantization must be separate concerns.

Notation quantization should support:

- Tuplet-aware resolution
- Tie splitting across beats and bars
- Graceful simplification for messy transcriptions

### Pedal inference

Pedal can be approximated from:

- Long overlap clusters
- Harmonic resonance persistence
- Chord sustain density

Pedal should be editable manually.

## Renderer Strategy

We should standardize on `MusicXML` as the interchange format for score persistence/export and keep an internal `ScoreDocument` model for live editing.

Reference:

- MusicXML structure documentation: https://www.w3.org/2021/06/musicxml40/tutorial/structure-of-musicxml-files/

Renderer evaluation should compare:

- A direct engraving renderer for interactive live score view
- A `MusicXML`-oriented renderer for interchange and fidelity

Relevant official references:

- VexFlow: https://vexflow.github.io/vexflow-docs/
- OpenSheetMusicDisplay: https://opensheetmusicdisplay.github.io/classdoc/

We should avoid locking the architecture to a renderer too early. The app should render from `ScoreDocument`, not from renderer-specific data.

## Transport Integration

The workspace must follow the same DAW transport authority.

Requirements:

- Playhead sync from `audioEngine` transport state
- Seek from notation click
- Region follow during playback
- Shared BPM and time signature
- Loop visualization

Important note:

The current engine scheduler is clip/audio-oriented, so the score workspace should initially consume transport state rather than trying to become the transport authority.

## Editing Model

Edits made in the score workspace must support two targets:

### Non-destructive score edits

- Only the score representation changes
- Original clip remains untouched
- Good for readability adjustments

### Source-affecting note edits

- Clip note timing or pitch is updated
- The score is regenerated or patched
- Good for MIDI correction workflows

The UI must make that distinction explicit.

## Quality Risks

### High risk

- Audio-to-score expectation mismatch on dense material
- Hand split instability
- Voice allocation producing unreadable notation
- Performance drops during large score rendering

### Medium risk

- Sync drift between score playhead and bottom piano cinema
- Dynamic interpretation from inconsistent velocity contracts
- Too much visual chrome harming readability

### Known code risk

The current repo appears to use inconsistent velocity ranges in some paths. This should be normalized before score dynamics are trusted.

## Delivery Phases

### Phase 0

- Freeze domain contracts
- Normalize note velocity semantics
- Add score workspace feature flag

### Phase 1

- Add sidebar entry and empty workspace shell
- Add score transport sync scaffolding
- Add bottom piano cinema shell

### Phase 2

- Implement `MIDI -> ScoreDocument`
- Render grand staff for MIDI clips
- Add follow-playhead and seek

### Phase 3

- Add correction tools
- Hand split controls
- Voice cleanup controls
- Notation simplification toggles

### Phase 4

- Wire audio transcription into score pipeline
- Add confidence overlays
- Add assisted cleanup suggestions

### Phase 5

- Add export/import interchange
- Add regression coverage
- Add performance tuning for large sessions

## Acceptance Criteria

### v1 must achieve

- A MIDI piano clip opens as readable grand staff notation
- Playback highlights score and bottom piano in sync
- Clicking a measure seeks transport reliably
- The score workspace feels visually native to HOLLOW BITS
- Audio piano transcription yields an editable draft score
- Low-confidence regions are visible and correctable

### v1 must not do

- Claim perfect automatic transcription on dense mixes
- Collapse into a generic educational Synthesia aesthetic
- Fork transport logic away from the main DAW

## Recommended Next Implementation Step

Start with Phase 0 and Phase 1 only:

- define types
- mount the new sidebar workspace
- create the resizable score/piano layout
- wire transport-follow

That gives the feature a native shell before we commit to the engraving engine and deep musical conversion logic.
