from __future__ import annotations

import json
import argparse
import re
import sys
from pathlib import Path
from typing import Any


SHA256 = re.compile(r"^[a-f0-9]{64}$")
STATUSES = {"edit_complete", "edit_complete_with_inference", "input_error"}
EVIDENCE_FAMILIES = {
    "asr", "forced_alignment", "phoneme", "vad", "onset", "silence",
    "energy", "pitch", "human_lock", "neighbor_anchor", "project_bound",
    "frame_check",
}
INFERENCE_METHODS = {
    "signal_reconciliation", "anchored_constraint", "local_rate_interpolation",
    "proportional_phrase_allocation", "adjacent_geometry",
}
UNTOUCHED_DOMAINS = [
    "clips", "clipOrder", "clipTiming", "canvas", "videoAssets", "imageAssets",
    "audioRegions", "cropTransforms", "projectDuration",
]


def is_record(value: Any) -> bool:
    return isinstance(value, dict)


def is_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def allowed_keys(value: Any, allowed: set[str], path: str, errors: list[str]) -> None:
    if not is_record(value):
        return
    for key in value:
        if key not in allowed:
            errors.append(f"{path} contains unsupported field: {key}")


def unique_strings(
    value: Any,
    path: str,
    errors: list[str],
    minimum: int = 0,
) -> list[str]:
    valid = (
        isinstance(value, list)
        and len(value) >= minimum
        and all(isinstance(item, str) and len(item) > 0 for item in value)
        and len(set(value)) == len(value)
    )
    if not valid:
        errors.append(
            f"{path} must be a unique string array with at least {minimum} item(s)"
        )
        return []
    return value


def validate_boundary(
    boundary: Any,
    path: str,
    expected_tick: Any,
    evidence_by_id: dict[str, dict[str, Any]],
    duration_ticks: int | None,
    timeline_audio_sha256: str,
    errors: list[str],
) -> str | None:
    if not is_record(boundary):
        errors.append(f"{path} must be an object")
        return None
    allowed_keys(
        boundary,
        {"tick", "minTick", "maxTick", "basis", "confidenceMilli", "signalRefs", "inferenceMethod"},
        path,
        errors,
    )
    tick = boundary.get("tick")
    minimum = boundary.get("minTick")
    maximum = boundary.get("maxTick")
    basis = boundary.get("basis")
    confidence = boundary.get("confidenceMilli")
    inference_method = boundary.get("inferenceMethod")
    if not is_integer(tick) or tick < 0 or tick != expected_tick:
        errors.append(f"{path}.tick must equal {expected_tick}")
    if (
        not is_integer(minimum)
        or not is_integer(maximum)
        or minimum < 0
        or maximum < minimum
        or not is_integer(tick)
        or tick < minimum
        or tick > maximum
    ):
        errors.append(f"{path} uncertainty bounds are invalid")
    if not is_integer(confidence) or confidence < 0 or confidence > 1000:
        errors.append(f"{path}.confidenceMilli is invalid")

    refs = unique_strings(boundary.get("signalRefs"), f"{path}.signalRefs", errors, 1)
    referenced: list[dict[str, Any]] = []
    for evidence_id in refs:
        evidence = evidence_by_id.get(evidence_id)
        if evidence is None:
            errors.append(f"{path}.signalRefs references unknown evidence: {evidence_id}")
        else:
            referenced.append(evidence)
            evidence_minimum = evidence.get("minTick")
            evidence_maximum = evidence.get("maxTick")
            if (
                is_integer(minimum)
                and is_integer(maximum)
                and is_integer(evidence_minimum)
                and is_integer(evidence_maximum)
                and (evidence_maximum < minimum or evidence_minimum > maximum)
            ):
                errors.append(
                    f"{path}.signalRefs evidence does not intersect this boundary: {evidence_id}"
                )
            if evidence.get("audioSha256") != timeline_audio_sha256:
                errors.append(
                    f"{path}.signalRefs evidence is not tied to the locked timeline audio: {evidence_id}"
                )
            if (
                duration_ticks is not None
                and is_integer(evidence_maximum)
                and evidence_maximum > duration_ticks
            ):
                errors.append(f"{path}.signalRefs evidence exceeds project duration: {evidence_id}")
    families = {evidence.get("family") for evidence in referenced}
    groups = {evidence.get("dependencyGroup") for evidence in referenced}

    if basis == "measured":
        if is_integer(minimum) and is_integer(maximum) and maximum - minimum > 1:
            errors.append(f"{path} measured uncertainty may span at most one tick")
        if not is_integer(confidence) or confidence < 700:
            errors.append(f"{path} measured confidence must be at least 700")
        if len(families) < 2 or len(groups) < 2:
            errors.append(
                f"{path} measured timing requires two independent families and dependency groups"
            )
        if inference_method is not None:
            errors.append(f"{path}.inferenceMethod must be null for measured timing")
    elif basis == "inferred":
        if not is_integer(confidence) or confidence >= 700:
            errors.append(f"{path} inferred confidence must stay below 700")
        if inference_method not in INFERENCE_METHODS:
            errors.append(f"{path} inferred timing requires a documented inferenceMethod")
    elif basis == "human_locked":
        if not any(evidence.get("family") == "human_lock" for evidence in referenced):
            errors.append(f"{path} human_locked timing must cite human_lock evidence")
        if inference_method is not None:
            errors.append(f"{path}.inferenceMethod must be null for human_locked timing")
        if any(evidence.get("tick") != tick for evidence in referenced):
            errors.append(f"{path} human_lock evidence must use the exact locked boundary tick")
    else:
        errors.append(f"{path}.basis is invalid")
    return basis if isinstance(basis, str) else None


def validate_lines(
    lines: Any,
    path: str,
    errors: list[str],
    nullable: bool = False,
) -> None:
    if nullable and lines is None:
        return
    if (
        not isinstance(lines, list)
        or not 1 <= len(lines) <= 2
        or any(not isinstance(line, str) or not line.strip() for line in lines)
    ):
        errors.append(f"{path} must contain one or two non-empty display lines")


def validate_subtitle_edit(document: Any) -> list[str]:
    errors: list[str] = []
    if not is_record(document):
        return ["root must be an object"]
    allowed_keys(document, {
        "schemaVersion", "status", "mode", "requiresHumanReview",
        "humanReviewState", "applyToEditorAllowed", "autoExportAllowed",
        "baseProject", "evidenceCatalog", "subtitleEdit", "reviewQueue", "issues",
    }, "root", errors)
    if document.get("schemaVersion") != "kirinuki/picture-locked-song-subtitle-edit-v1":
        errors.append("schemaVersion is invalid")
    if document.get("status") not in STATUSES:
        errors.append("status is invalid")
    if document.get("mode") != "subtitle_only_on_picture_lock":
        errors.append("mode must be subtitle_only_on_picture_lock")
    if document.get("requiresHumanReview") is not True:
        errors.append("requiresHumanReview must be true")
    if document.get("humanReviewState") != "pending":
        errors.append("humanReviewState must remain pending")
    if document.get("applyToEditorAllowed") is not True:
        errors.append("applyToEditorAllowed must be true")
    if document.get("autoExportAllowed") is not False:
        errors.append("autoExportAllowed must be false")

    input_error = document.get("status") == "input_error"
    base = document.get("baseProject")
    allow_new_cues = False
    replaceable_cue_ids: set[str] = set()
    human_locked_cue_ids: set[str] = set()
    duration_ticks: int | None = None
    timeline_audio_sha256 = ""
    allowed_style_tokens: set[str] = set()
    minimum_font_scale = 1
    safe_min_x, safe_max_x, safe_min_y, safe_max_y = 0, 1000, 0, 1000
    maximum_position_delta = 1000
    maximum_font_scale_delta = 1999
    if not input_error or base is not None:
        if not is_record(base):
            errors.append("baseProject must be an object for a usable task")
        else:
            allowed_keys(base, {
                "projectId", "revision", "pictureLockSha256", "timelineAudioSha256",
                "lyricsCatalogSha256", "evidenceBundleSha256", "frameSetSha256",
                "durationTicks", "tickRate", "endSemantics", "allowNewCues",
                "replaceableCueIds", "humanLockedCueIds", "layoutPolicy",
            }, "baseProject", errors)
            if not isinstance(base.get("projectId"), str) or not base.get("projectId"):
                errors.append("baseProject.projectId is required")
            if not isinstance(base.get("revision"), str) or not base.get("revision"):
                errors.append("baseProject.revision is required")
            for key in (
                "pictureLockSha256", "timelineAudioSha256", "lyricsCatalogSha256",
                "evidenceBundleSha256", "frameSetSha256",
            ):
                value = base.get(key)
                if not isinstance(value, str) or not SHA256.fullmatch(value):
                    errors.append(f"baseProject.{key} must be a lowercase SHA-256")
            duration = base.get("durationTicks")
            if not is_integer(duration) or duration < 1:
                errors.append("baseProject.durationTicks must be positive")
            else:
                duration_ticks = duration
            if isinstance(base.get("timelineAudioSha256"), str):
                timeline_audio_sha256 = base["timelineAudioSha256"]
            if base.get("tickRate") != 60 or base.get("endSemantics") != "exclusive":
                errors.append("baseProject must use 60 Hz ticks and exclusive ends")
            if not isinstance(base.get("allowNewCues"), bool):
                errors.append("baseProject.allowNewCues must be boolean")
            else:
                allow_new_cues = base["allowNewCues"]
            replaceable_cue_ids.update(unique_strings(
                base.get("replaceableCueIds"), "baseProject.replaceableCueIds", errors
            ))
            human_locked_cue_ids.update(unique_strings(
                base.get("humanLockedCueIds"), "baseProject.humanLockedCueIds", errors
            ))
            if replaceable_cue_ids & human_locked_cue_ids:
                errors.append("replaceableCueIds and humanLockedCueIds must not overlap")
            layout_policy = base.get("layoutPolicy")
            if not is_record(layout_policy):
                errors.append("baseProject.layoutPolicy must be an object")
            else:
                allowed_keys(layout_policy, {
                    "allowedStyleTokens", "minFontScaleMilli", "safeArea",
                    "maxAdjacentPositionDeltaMilli", "maxAdjacentFontScaleDeltaMilli",
                }, "baseProject.layoutPolicy", errors)
                allowed_style_tokens.update(unique_strings(
                    layout_policy.get("allowedStyleTokens"),
                    "baseProject.layoutPolicy.allowedStyleTokens",
                    errors,
                    1,
                ))
                policy_minimum_font = layout_policy.get("minFontScaleMilli")
                if not is_integer(policy_minimum_font) or not 1 <= policy_minimum_font <= 2000:
                    errors.append("baseProject.layoutPolicy.minFontScaleMilli is invalid")
                else:
                    minimum_font_scale = policy_minimum_font
                safe_area = layout_policy.get("safeArea")
                if not is_record(safe_area):
                    errors.append("baseProject.layoutPolicy.safeArea must be an object")
                else:
                    allowed_keys(safe_area, {
                        "minXMilli", "maxXMilli", "minYMilli", "maxYMilli",
                    }, "baseProject.layoutPolicy.safeArea", errors)
                    safe_values = [
                        safe_area.get("minXMilli"), safe_area.get("maxXMilli"),
                        safe_area.get("minYMilli"), safe_area.get("maxYMilli"),
                    ]
                    if (
                        any(not is_integer(value) or value < 0 or value > 1000 for value in safe_values)
                        or safe_values[0] > safe_values[1]
                        or safe_values[2] > safe_values[3]
                    ):
                        errors.append("baseProject.layoutPolicy.safeArea bounds are invalid")
                    else:
                        safe_min_x, safe_max_x, safe_min_y, safe_max_y = safe_values
                position_delta = layout_policy.get("maxAdjacentPositionDeltaMilli")
                if not is_integer(position_delta) or not 0 <= position_delta <= 1000:
                    errors.append("baseProject.layoutPolicy.maxAdjacentPositionDeltaMilli is invalid")
                else:
                    maximum_position_delta = position_delta
                scale_delta = layout_policy.get("maxAdjacentFontScaleDeltaMilli")
                if not is_integer(scale_delta) or not 0 <= scale_delta <= 1999:
                    errors.append("baseProject.layoutPolicy.maxAdjacentFontScaleDeltaMilli is invalid")
                else:
                    maximum_font_scale_delta = scale_delta

    evidence_by_id: dict[str, dict[str, Any]] = {}
    evidence_catalog = document.get("evidenceCatalog")
    if not isinstance(evidence_catalog, list):
        errors.append("evidenceCatalog must be an array")
    else:
        for index, evidence in enumerate(evidence_catalog):
            path = f"evidenceCatalog[{index}]"
            if not is_record(evidence):
                errors.append(f"{path} must be an object")
                continue
            allowed_keys(evidence, {
                "id", "family", "dependencyGroup", "audioSha256", "tick",
                "minTick", "maxTick", "confidenceMilli",
            }, path, errors)
            evidence_id = evidence.get("id")
            if not isinstance(evidence_id, str) or not evidence_id:
                errors.append(f"{path}.id is required")
            elif evidence_id in evidence_by_id:
                errors.append(f"duplicate evidence id: {evidence_id}")
            if evidence.get("family") not in EVIDENCE_FAMILIES:
                errors.append(f"{path}.family is invalid")
            if not isinstance(evidence.get("dependencyGroup"), str) or not evidence.get("dependencyGroup"):
                errors.append(f"{path}.dependencyGroup is required")
            evidence_audio_hash = evidence.get("audioSha256")
            if not isinstance(evidence_audio_hash, str) or not SHA256.fullmatch(evidence_audio_hash):
                errors.append(f"{path}.audioSha256 is invalid")
            elif timeline_audio_sha256 and evidence_audio_hash != timeline_audio_sha256:
                errors.append(f"{path}.audioSha256 does not match locked timeline audio")
            tick = evidence.get("tick")
            minimum = evidence.get("minTick")
            maximum = evidence.get("maxTick")
            if (
                not is_integer(tick)
                or not is_integer(minimum)
                or not is_integer(maximum)
                or minimum < 0
                or maximum < minimum
                or tick < minimum
                or tick > maximum
            ):
                errors.append(f"{path} tick bounds are invalid")
            confidence = evidence.get("confidenceMilli")
            if not is_integer(confidence) or confidence < 0 or confidence > 1000:
                errors.append(f"{path}.confidenceMilli is invalid")
            if duration_ticks is not None and is_integer(maximum) and maximum > duration_ticks:
                errors.append(f"{path} exceeds the locked project duration")
            if isinstance(evidence_id, str) and evidence_id:
                evidence_by_id[evidence_id] = evidence

    subtitle_edit = document.get("subtitleEdit")
    if not is_record(subtitle_edit):
        return [*errors, "subtitleEdit must be an object"]
    allowed_keys(subtitle_edit, {
        "pictureLockSha256", "lanesRequired", "untouchedDomains", "operations",
    }, "subtitleEdit", errors)
    if (
        not input_error
        and (not is_record(base) or subtitle_edit.get("pictureLockSha256") != base.get("pictureLockSha256"))
    ):
        errors.append("subtitleEdit.pictureLockSha256 must match the locked base project")
    lanes_required = subtitle_edit.get("lanesRequired")
    if not is_integer(lanes_required) or not 0 <= lanes_required <= 8:
        errors.append("subtitleEdit.lanesRequired must be 0..8")
    if subtitle_edit.get("untouchedDomains") != UNTOUCHED_DOMAINS:
        errors.append(
            "subtitleEdit.untouchedDomains must preserve every picture/audio domain exactly"
        )
    operations = subtitle_edit.get("operations")
    if not isinstance(operations, list):
        return [*errors, "subtitleEdit.operations must be an array"]
    if input_error and operations:
        errors.append("input_error must not fabricate subtitle operations")
    if not input_error and not operations:
        errors.append("usable input requires a complete subtitle edit")

    cue_ids: set[str] = set()
    occurrences: dict[str, int] = {}
    last_end_by_lane: dict[int, int] = {}
    has_inference = False
    high_priority_cue_ids: set[str] = set()
    previous_operation_start = -1
    previous_layout: tuple[int, int, int] | None = None

    for index, operation in enumerate(operations):
        path = f"subtitleEdit.operations[{index}]"
        if not is_record(operation):
            errors.append(f"{path} must be an object")
            continue
        allowed_keys(operation, {
            "op", "cueId", "existingCueId", "sourceLineId", "occurrence",
            "sourceTextSha256", "startTick", "endTickExclusive", "captions",
            "layout", "timingBasis", "reviewPriority", "matchScoreMilli",
            "runnerUpMarginMilli", "startBoundary", "endBoundary", "reasonCodes",
        }, path, errors)
        operation_kind = operation.get("op")
        existing_cue_id = operation.get("existingCueId")
        cue_id = operation.get("cueId")
        if operation_kind not in {"add", "update"}:
            errors.append(f"{path}.op is invalid")
        if operation_kind == "add" and existing_cue_id is not None:
            errors.append(f"{path} add must use existingCueId: null")
        if operation_kind == "update" and (
            not isinstance(existing_cue_id, str) or not existing_cue_id
        ):
            errors.append(f"{path} update requires existingCueId")
        if operation_kind == "add" and not allow_new_cues:
            errors.append(f"{path} cannot add a cue outside the supplied write scope")
        if operation_kind == "update" and existing_cue_id not in replaceable_cue_ids:
            errors.append(f"{path} can update only an explicitly replaceable cue")
        if cue_id in human_locked_cue_ids or existing_cue_id in human_locked_cue_ids:
            errors.append(f"{path} cannot target a human-locked cue")
        if not isinstance(cue_id, str) or not cue_id:
            errors.append(f"{path}.cueId is required")
        elif cue_id in cue_ids:
            errors.append(f"duplicate cueId: {cue_id}")
        else:
            cue_ids.add(cue_id)
        source_line_id = operation.get("sourceLineId")
        occurrence = operation.get("occurrence")
        if not isinstance(source_line_id, str) or not source_line_id:
            errors.append(f"{path}.sourceLineId is required")
        if not is_integer(occurrence) or occurrence < 1:
            errors.append(f"{path}.occurrence must be positive")
        elif isinstance(source_line_id, str):
            previous = occurrences.get(source_line_id, 0)
            if occurrence != previous + 1:
                errors.append(f"{path}.occurrence must be chronological and consecutive")
            occurrences[source_line_id] = occurrence
        source_hash = operation.get("sourceTextSha256")
        if not isinstance(source_hash, str) or not SHA256.fullmatch(source_hash):
            errors.append(f"{path}.sourceTextSha256 is invalid")
        start_tick = operation.get("startTick")
        end_tick = operation.get("endTickExclusive")
        if (
            not is_integer(start_tick)
            or not is_integer(end_tick)
            or start_tick < 0
            or start_tick >= end_tick
        ):
            errors.append(f"{path} interval is invalid")
        elif start_tick < previous_operation_start:
            errors.append(f"{path} operations must be chronological for whole-edit layout review")
        else:
            previous_operation_start = start_tick
        if is_record(base) and is_integer(end_tick) and end_tick > base.get("durationTicks", -1):
            errors.append(f"{path} exceeds the locked project duration")

        captions = operation.get("captions")
        if not is_record(captions):
            errors.append(f"{path}.captions must be an object")
        else:
            allowed_keys(captions, {"jaLines", "koLines"}, f"{path}.captions", errors)
            validate_lines(captions.get("jaLines"), f"{path}.captions.jaLines", errors)
            validate_lines(
                captions.get("koLines"), f"{path}.captions.koLines", errors, True
            )

        layout = operation.get("layout")
        if not is_record(layout):
            errors.append(f"{path}.layout must be an object")
        else:
            allowed_keys(layout, {
                "lane", "xMilli", "yMilli", "align", "styleToken",
                "japanesePlacement", "fontScaleMilli", "basis", "checkedFrameTicks",
            }, f"{path}.layout", errors)
            lane = layout.get("lane")
            if (
                not is_integer(lane)
                or lane < 0
                or lane > 7
                or not is_integer(lanes_required)
                or lane >= lanes_required
            ):
                errors.append(f"{path}.layout.lane is outside lanesRequired")
            for key in ("xMilli", "yMilli"):
                value = layout.get(key)
                if not is_integer(value) or value < 0 or value > 1000:
                    errors.append(f"{path}.layout.{key} is invalid")
            if layout.get("align") not in {"left", "center", "right"}:
                errors.append(f"{path}.layout.align is invalid")
            if not isinstance(layout.get("styleToken"), str) or not layout.get("styleToken"):
                errors.append(f"{path}.layout.styleToken is required")
            elif layout.get("styleToken") not in allowed_style_tokens:
                errors.append(f"{path}.layout.styleToken is outside the locked layout policy")
            if layout.get("japanesePlacement") not in {"above_korean", "japanese_only"}:
                errors.append(f"{path}.layout.japanesePlacement is invalid")
            font_scale = layout.get("fontScaleMilli")
            if not is_integer(font_scale) or not 1 <= font_scale <= 2000:
                errors.append(f"{path}.layout.fontScaleMilli is invalid")
            elif font_scale < minimum_font_scale:
                errors.append(f"{path}.layout.fontScaleMilli is below the readable policy minimum")
            layout_basis = layout.get("basis")
            if layout_basis not in {"frame_checked", "template_inferred", "human_locked"}:
                errors.append(f"{path}.layout.basis is invalid")
            checked_ticks = layout.get("checkedFrameTicks")
            checked_ticks_valid = (
                isinstance(checked_ticks, list)
                and all(is_integer(tick) for tick in checked_ticks)
                and len(set(checked_ticks)) == len(checked_ticks)
                and is_integer(start_tick)
                and is_integer(end_tick)
                and all(start_tick <= tick < end_tick for tick in checked_ticks)
            )
            if not checked_ticks_valid:
                errors.append(f"{path}.layout.checkedFrameTicks is invalid")
            if layout_basis == "frame_checked" and (
                not isinstance(checked_ticks, list) or not checked_ticks
            ):
                errors.append(f"{path} frame_checked layout requires checked frames")
            if (
                layout_basis == "frame_checked"
                and is_integer(start_tick)
                and is_integer(end_tick)
                and isinstance(checked_ticks, list)
            ):
                required_checks = {start_tick, (start_tick + end_tick) // 2, end_tick - 1}
                if not required_checks.issubset(set(checked_ticks)):
                    errors.append(f"{path} frame_checked layout must inspect start, midpoint, and end")
            if layout_basis == "template_inferred":
                has_inference = True
                if isinstance(cue_id, str):
                    high_priority_cue_ids.add(cue_id)
            if is_integer(lane) and is_integer(start_tick):
                previous_end = last_end_by_lane.get(lane, 0)
                if start_tick < previous_end:
                    errors.append(f"{path} overlaps an earlier operation in the same subtitle lane")
                if is_integer(end_tick):
                    last_end_by_lane[lane] = end_tick
            x_position = layout.get("xMilli")
            y_position = layout.get("yMilli")
            if is_integer(x_position) and is_integer(y_position):
                if not safe_min_x <= x_position <= safe_max_x or not safe_min_y <= y_position <= safe_max_y:
                    errors.append(f"{path}.layout position is outside the locked safe area")
                if previous_layout is not None and (
                    abs(x_position - previous_layout[0]) > maximum_position_delta
                    or abs(y_position - previous_layout[1]) > maximum_position_delta
                ):
                    errors.append(f"{path}.layout position jumps beyond the whole-edit policy")
                if is_integer(font_scale):
                    if previous_layout is not None and abs(font_scale - previous_layout[2]) > maximum_font_scale_delta:
                        errors.append(f"{path}.layout font scale jumps beyond the whole-edit policy")
                    previous_layout = (x_position, y_position, font_scale)

        match_score = operation.get("matchScoreMilli")
        runner_up_margin = operation.get("runnerUpMarginMilli")
        if not is_integer(match_score) or not 0 <= match_score <= 1000:
            errors.append(f"{path}.matchScoreMilli is invalid")
        if not is_integer(runner_up_margin) or not 0 <= runner_up_margin <= 1000:
            errors.append(f"{path}.runnerUpMarginMilli is invalid")
        start_basis = validate_boundary(
            operation.get("startBoundary"), f"{path}.startBoundary", start_tick,
            evidence_by_id, duration_ticks, timeline_audio_sha256, errors,
        )
        end_basis = validate_boundary(
            operation.get("endBoundary"), f"{path}.endBoundary", end_tick,
            evidence_by_id, duration_ticks, timeline_audio_sha256, errors,
        )
        if start_basis == "inferred" or end_basis == "inferred":
            derived_basis = "inferred"
        elif start_basis == "human_locked" or end_basis == "human_locked":
            derived_basis = "human_locked"
        else:
            derived_basis = "measured"
        if operation.get("timingBasis") != derived_basis:
            errors.append(f"{path}.timingBasis must match boundary bases")
        if derived_basis == "measured" and (
            not is_integer(match_score)
            or not is_integer(runner_up_margin)
            or match_score < 700
            or runner_up_margin < 100
        ):
            errors.append(
                f"{path} measured match requires score >=700 and runner-up margin >=100"
            )
        if derived_basis == "inferred":
            has_inference = True
            if isinstance(cue_id, str):
                high_priority_cue_ids.add(cue_id)
        if operation.get("reviewPriority") not in {"normal", "high"}:
            errors.append(f"{path}.reviewPriority is invalid")
        if cue_id in high_priority_cue_ids and operation.get("reviewPriority") != "high":
            errors.append(f"{path} inferred timing or layout requires high reviewPriority")
        reasons = unique_strings(operation.get("reasonCodes"), f"{path}.reasonCodes", errors)
        if cue_id in high_priority_cue_ids and not reasons:
            errors.append(f"{path} inferred work requires a public reason code")

    if document.get("status") == "edit_complete" and has_inference:
        errors.append("edit_complete cannot contain inferred timing or layout")
    if document.get("status") == "edit_complete_with_inference" and not has_inference:
        errors.append("edit_complete_with_inference requires inferred timing or layout")

    review_queue = document.get("reviewQueue")
    if not isinstance(review_queue, list):
        errors.append("reviewQueue must be an array")
    else:
        reviewed: set[str] = set()
        for index, review in enumerate(review_queue):
            path = f"reviewQueue[{index}]"
            if not is_record(review):
                errors.append(f"{path} must be an object")
                continue
            allowed_keys(review, {"cueId", "priority", "reasonCodes"}, path, errors)
            cue_id = review.get("cueId")
            if cue_id not in cue_ids:
                errors.append(f"{path} references unknown cueId")
            if cue_id in reviewed:
                errors.append(f"{path} duplicates a cue review")
            if isinstance(cue_id, str):
                reviewed.add(cue_id)
            if review.get("priority") not in {"normal", "high"}:
                errors.append(f"{path}.priority is invalid")
            if cue_id in high_priority_cue_ids and review.get("priority") != "high":
                errors.append(f"{path} must retain high inferred-work priority")
            unique_strings(review.get("reasonCodes"), f"{path}.reasonCodes", errors)
        if not input_error and reviewed != cue_ids:
            errors.append("reviewQueue must contain every subtitle operation exactly once")
        if input_error and review_queue:
            errors.append("input_error reviewQueue must be empty")

    issues = document.get("issues")
    if not isinstance(issues, list):
        errors.append("issues must be an array")
    else:
        has_input_error_issue = False
        for index, issue in enumerate(issues):
            path = f"issues[{index}]"
            if not is_record(issue):
                errors.append(f"{path} must be an object")
                continue
            allowed_keys(issue, {"code", "severity", "cueIds", "message"}, path, errors)
            if not isinstance(issue.get("code"), str) or not issue.get("code"):
                errors.append(f"{path}.code is required")
            if issue.get("severity") not in {"info", "review", "input_error"}:
                errors.append(f"{path}.severity is invalid")
            if issue.get("severity") == "input_error":
                has_input_error_issue = True
            unique_strings(issue.get("cueIds"), f"{path}.cueIds", errors)
            if not isinstance(issue.get("message"), str) or not issue.get("message"):
                errors.append(f"{path}.message is required")
        if input_error and not has_input_error_issue:
            errors.append("input_error requires a concrete input_error issue")
    return errors


def validate_current_lock(document: Any, current_lock: Any) -> list[str]:
    errors: list[str] = []
    if not is_record(document) or not is_record(document.get("baseProject")):
        return ["cannot compare current lock without a valid baseProject"]
    if not is_record(current_lock):
        return ["current lock must be an object"]
    lock_keys = {
        "projectId", "revision", "pictureLockSha256", "timelineAudioSha256",
        "lyricsCatalogSha256", "evidenceBundleSha256", "frameSetSha256",
        "durationTicks",
    }
    allowed_keys(current_lock, lock_keys, "currentLock", errors)
    base = document["baseProject"]
    for key in sorted(lock_keys):
        if key not in current_lock:
            errors.append(f"currentLock.{key} is required")
        elif current_lock[key] != base.get(key):
            errors.append(f"currentLock.{key} does not match the editor state used for this subtitle edit")
    return errors


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate a completed subtitle-only edit before transactional insertion."
    )
    parser.add_argument("edit", help="Subtitle edit JSON path, or - for stdin")
    parser.add_argument(
        "--current-lock",
        help="Fresh editor lock tuple JSON captured immediately before insertion",
    )
    arguments = parser.parse_args()
    source = sys.stdin.read() if arguments.edit == "-" else Path(arguments.edit).read_text("utf-8")
    document = json.loads(source)
    errors = validate_subtitle_edit(document)
    if arguments.current_lock:
        current_lock = json.loads(Path(arguments.current_lock).read_text("utf-8"))
        errors.extend(validate_current_lock(document, current_lock))
    if errors:
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        raise SystemExit(1)
    print("Subtitle edit is valid, may be inserted, and still requires human review.")


if __name__ == "__main__":
    main()
