---
name: align-song-subtitles-60fps
description: Time song lyrics and apply a complete Japanese and Korean subtitle edit to an already cut and composed short-form project without changing picture, audio, crops, or edit timing. Use after a human has picture-locked the cut and wants a semi-automatic AI Agent to finish 1/60-second lyric timing, line breaks, lanes, placement, and style as one coherent edit for post-application human review.
---

# Time Song Lyrics on a Human-Finished Cut

Act as a semi-automatic subtitle finisher. A human has already chosen every cut, edit point, crop, visual composition, video layer, image, and audio mix. Read that picture-locked project, create a complete subtitle-only edit, and apply it as one coherent transaction for human review afterward.

Finish and apply the subtitle domain, not the picture edit. Never export, publish, or alter the human-authored video and audio composition.

## Fixed responsibility boundary

Treat these project domains as immutable:

- clips, clip order, clip starts, clip ends, trims, and transitions;
- canvas size, project duration, crop, zoom, position, and visual transforms;
- video layers, image assets, and their timing or stacking;
- audio regions, source audio, gain, fades, mute, and mix;
- source downloads, caches, media preparation, and export settings.

You may create or update only explicitly authorized subtitle fields:

- Japanese and Korean display text;
- cue start and exclusive end on a 60-tick-per-second project timeline;
- subtitle lane, line breaks, X/Y position, alignment, and approved style token;
- public timing, text, and layout review metadata.

Do not acquire media, redraw the cut, extend a clip, move a visual, retime audio, or “improve” the composition to help a subtitle fit. Move or split the subtitle instead.

## Preserve the semi-automatic handoff

- Start only after the human explicitly runs the subtitle task on a picture-locked project.
- Emit a complete subtitle edit with `applyToEditorAllowed: true`, `requiresHumanReview: true`, `humanReviewState: "pending"`, and `autoExportAllowed: false`.
- Require the host to compare the edit's `pictureLockSha256` with the current project immediately before applying it.
- If the fingerprint changed, discard the subtitle edit and rerun against the new cut.
- Create one undo checkpoint, then apply the complete subtitle edit transactionally. Roll back the entire subtitle transaction if any operation fails.
- Insert inferred cues too, but keep their visible review flags and high priority.
- Never click, simulate, or claim that the human's post-application review is complete.
- Keep every existing human-locked cue unchanged.
- Update only cue IDs listed as replaceable. Add new cues only when the supplied write scope allows additions.
- Do not run continuously or remember the project after the task ends.

Human review happens after insertion, but it is not a reason to leave the edit incomplete. With usable inputs, give every intended lyric occurrence concrete text, timing, and placement. Mark weak decisions for review instead of leaving null or pending fields.

## Require the picture-locked subtitle packet

Require one bounded task packet containing:

- project ID, revision, duration, and `pictureLockSha256`;
- a project-local audio proxy rendered from exactly that locked timeline, beginning at project tick 0, plus its SHA-256;
- ordered Japanese display lyrics with stable line and occurrence IDs;
- approved Korean translations when bilingual captions are requested;
- `lyricsCatalogSha256` covering the approved display strings and pairing;
- existing subtitle cues, human-locked cue IDs, replaceable cue IDs, and whether new cues may be added;
- available subtitle lanes and a locked layout policy containing safe-area bounds, allowed style tokens, minimum readable type scale, and maximum adjacent position/size movement;
- representative project-local frame thumbnails or subject/face masks plus a `frameSetSha256` when placement should react to the picture;
- an `evidenceBundleSha256` and evidence records tied to the exact timeline-audio SHA-256;
- timestamped local ASR or forced-alignment evidence when available.

The audio proxy must already match the human-finished cut. Do not solve source-VOD offsets, preroll, downloading, or remuxing in this skill. If the audio starts somewhere other than project tick 0 or its fingerprint does not match the task packet, return `input_error` rather than guessing a different edit.

## Keep approved display text separate from matching text

- Preserve `displayJa` and `displayKo` exactly unless the human explicitly authorizes copy editing.
- Create separate internal Japanese matching forms for kana/kanji variants, punctuation, spaces, contractions, and sung elongation.
- Never use Korean phonetic transcription to align Japanese vocals.
- Do not output romaji, furigana readings embedded beside kanji, or Korean pronunciation text unless explicitly requested.
- Do not silently rewrite the Korean translation while synchronizing it. Put optional copy suggestions in issues, outside the subtitle edit.

## Use AI Agents as narrow workers

Use an AI Agent only for small, explicit subtasks. Low-cost agents are suitable for the text, timing, layout, and audit passes, but keep the locked project snapshot and deterministic subtitle-edit validator as the authority.

Recommended passes:

1. A text worker pairs approved lyric occurrences with timestamped Japanese vocal tokens.
2. A timing worker refines start and end boundaries from supplied local audio evidence.
3. A layout worker checks representative frames and proposes subtitle-only lanes, line breaks, and positions.
4. A fresh audit worker tries to disprove the candidate without changing the cut.
5. Deterministic scripts quantize ticks and validate the final subtitle edit.

Do not ask a worker to change video or audio state. Do not ask a model to perform arithmetic that a deterministic tool can perform.

## Pass 1: freeze and verify scope

- Record the base revision and `pictureLockSha256` before any analysis.
- Verify the audio proxy begins at project tick 0 and ends at project duration.
- Verify the lyrics catalog hash and every Japanese/Korean line pairing.
- Record human-locked and replaceable cue IDs.
- Reject any requested operation outside subtitle fields.
- Never derive a new duration from the lyrics or audio.

## Pass 2: build the monotonic lyric map

- Map every lyric occurrence across the existing project timeline in order.
- Give repeated choruses distinct occurrence numbers.
- For a new cue, derive the stable ID as `cue:<sourceLineId>:<occurrence>`; never use a random UUID. Preserve an existing cue ID exactly when updating it.
- Use the full song sequence, neighboring reliable anchors, and cut boundaries to distinguish repeated lines.
- Prefer word- or phoneme-timestamped evidence over broad ASR segments.
- Record the best match score and runner-up margin.
- When the approved catalog contains exactly one possible occurrence, use `runnerUpMarginMilli: 1000`; score the text-to-occurrence match independently from timing confidence. Otherwise derive both 0–1000 scores from the same matcher and do not invent a margin.
- Never omit a repeated line merely because its text matches an earlier occurrence.

## Pass 3: refine boundaries at 1/60 second

- Locate each start at the first audible vocal phoneme or intentional pickup.
- Locate each exclusive end after the final audible phoneme/release and before the next phrase when appropriate.
- Account for breaths, melisma, reverb, instrumental gaps, and overlapping vocals explicitly.
- Prefer two independent signal families and dependency groups agreeing within one tick.
- Store integer project ticks only as timing authority.
- Use `python3 scripts/quantize_60fps.py` for decimal project-local seconds.
- Never apply a universal four-second cue limit.
- Never silently shift a tick merely to hide a zero-length cue or same-lane overlap.

## Pass 4: create comfortable bilingual layout

Use the supplied safe areas and representative locked frames. Change subtitles only.

Optimize the complete subtitle sequence before insertion, not one cue in isolation. Keep typography, Japanese/Korean spacing, lane choice, visual rhythm, and baseline movement coherent across the full edit. Minimize distracting position or size jumps between adjacent cues while still protecting faces and key action.

- Default to Japanese above and Korean below when both are present.
- Use the project's approved Japanese secondary color and Korean primary color; for the current Kirinuki convention this may be sky blue above and yellow below.
- Keep both languages visually paired to the same lyric phrase.
- Prefer a natural phrase split or another subtitle lane over shrinking below the supplied readable scale.
- Break lines at grammatical or musical phrase boundaries, not arbitrary character counts.
- Avoid faces, key text, and important action by moving the caption within allowed safe areas.
- Check placement at cue start, midpoint, and end when frames are available, and cite the locked frame-set digest.
- If visual evidence is unavailable, use the approved template position, label layout as `template_inferred`, and assign high review priority.
- Do not move, crop, scale, or recolor the underlying picture to make room.

## Pass 5: audit independently

- Re-map vocal events back to lyric occurrence IDs without trusting the first pass.
- Audit repeated sections in reverse order.
- Compare drift at the beginning, middle, and end of the fixed timeline.
- Confirm no subtitle crosses an edit boundary accidentally; crossing is allowed only when the vocal and picture intentionally continue.
- Compare every output display string with the approved lyrics catalog.
- Confirm all operations target allowed subtitle fields and the original picture-lock fingerprint is unchanged.

## Resolve uncertainty instead of leaving holes

Use measured evidence through all strict passes first. If a boundary remains ambiguous but the packet is usable, apply the first justified fallback:

1. Reconcile token or phoneme candidates with VAD, onset, energy, pitch, or silence evidence.
2. Constrain the boundary between reliable neighboring subtitle anchors.
3. Interpolate inside that interval using local sung mora or syllable rate.
4. Allocate the phrase duration proportionally inside the nearest reliable vocal interval.
5. Use adjacent cue geometry and project bounds as the final fallback.

For each inferred boundary:

- assign a concrete tick and honest uncertainty interval;
- set `basis: "inferred"` and name the exact `inferenceMethod`;
- cite the evidence and anchors that constrained it;
- set confidence below the measured threshold;
- set cue `timingBasis: "inferred"` and `reviewPriority: "high"`;
- add a public reason code explaining why measurement failed.

Write reason codes as stable uppercase `SNAKE_CASE`, for example `FINAL_PHONEME_MASKED_BY_MUSIC`. Reuse the exact same code in the operation, review queue, and related issue instead of creating synonyms for one condition.

For a template-only placement, set `layout.basis: "template_inferred"` and high review priority. Never disguise inference as measured. Do not leave an otherwise usable cue unresolved.

## Build and apply the complete subtitle edit

Read `references/subtitle-edit.schema.json` before emitting the artifact. Output one JSON object with:

- `mode: "subtitle_only_on_picture_lock"`;
- the exact base project and picture-lock fingerprints;
- `applyToEditorAllowed: true`, `requiresHumanReview: true`, `humanReviewState: "pending"`, and `autoExportAllowed: false`;
- a complete subtitle edit containing only authorized add/update cue operations;
- an exact immutable-domain declaration;
- concrete 60 Hz timing, display lines, lanes, layout, and evidence for every cue;
- a review queue containing every changed or added cue;
- `edit_complete_with_inference` when any timing or layout uses inference, otherwise `edit_complete`.

Run:

```bash
python3 scripts/validate_subtitle_edit.py path/to/subtitle-edit.json \
  --current-lock path/to/fresh-editor-lock.json
```

Fix every validator error. Capture the current lock tuple immediately before insertion and pass it to the validator; an internally self-consistent but stale edit must still fail. Then create an undo checkpoint and apply all subtitle operations in one transaction. Do not output chain-of-thought. Use concise evidence IDs and public reason codes.

## Post-application human review

Tell the host to:

1. verify project ID, revision, audio hash, lyrics hash, and picture-lock fingerprint immediately before insertion;
2. save one undo checkpoint and apply the complete subtitle edit transactionally;
3. open the resulting fully composed subtitle edit in the editor;
4. let the human review all cues, starting with high-priority timing or layout inference;
5. keep export and publication outside this skill until the human finishes review.

The agent must insert the complete subtitle edit, but never mark the later human review as completed on the human's behalf.

## Final checklist

- Confirm the human's cuts and composition were read-only throughout.
- Confirm the audio proxy represents that exact locked timeline from tick 0.
- Confirm every intended lyric occurrence has a concrete subtitle cue.
- Confirm repeated lyrics have distinct occurrence IDs.
- Confirm Japanese/Korean display strings match the approved catalog.
- Confirm no pronunciation layer was added accidentally.
- Confirm every inferred timing or template placement is visible in the review queue.
- Confirm long cues were not forced under a universal four-second cap.
- Confirm the applied edit contains subtitle fields only.
- Confirm deterministic validation passes.
- Apply the complete subtitle edit as one undoable transaction and leave human review pending.
