import type { DetectionConfidence, TriStateCapability } from "./types.js";

/**
 * FR-CLI-04: Capabilities distinguish true, false, and unknown.
 * Unknown is treated as unsupported for all execution decisions.
 */
export const isCapabilitySupported = (capability: TriStateCapability): boolean => {
  return capability === true;
};

/**
 * Only confirmed or user-selected probable targets can be modified.
 */
export const isTargetModifiable = (
  confidence: DetectionConfidence,
  userSelectedProbable = false,
): boolean => {
  if (confidence === "confirmed") {
    return true;
  }
  if (confidence === "probable" && userSelectedProbable) {
    return true;
  }
  return false;
};
